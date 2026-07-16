defmodule Allay.Servers.OperationSerializationTest do
  use Allay.DataCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts.Scope
  alias Allay.Backups
  alias Allay.Servers
  alias Allay.Servers.OperationLock

  setup do
    data_dir =
      Path.join(System.tmp_dir!(), "operation-lock-#{System.unique_integer([:positive])}")

    server_dir = Path.join([data_dir, "servers", Ecto.UUID.generate()])
    File.mkdir_p!(server_dir)
    File.write!(Path.join(server_dir, "server.jar"), "jar")
    File.write!(Path.join(server_dir, "server.properties"), "server-port=25565\n")
    on_exit(fn -> File.rm_rf!(data_dir) end)

    scope = user_fixture() |> Scope.for_user()
    server = server_fixture(%{directory: server_dir})

    %{data_dir: data_dir, scope: scope, server: server}
  end

  test "backup fails before touching persistence when another operation owns the server", ctx do
    owner = hold_operation(ctx.server.id, :restore)

    assert {:error, {:operation_in_progress, :restore}} =
             Backups.create_backup(ctx.scope, ctx.server.id, "manual", data_dir: ctx.data_dir)

    assert [] = Backups.list_backups(ctx.scope, ctx.server.id)
    release_operation(owner)
  end

  test "start fails before resolving runtime configuration during another operation", ctx do
    owner = hold_operation(ctx.server.id, :import)

    assert {:error, {:operation_in_progress, :import}} =
             Servers.start_server(ctx.scope, ctx.server.id)

    release_operation(owner)
  end

  test "delete conflict preserves the database row and directory", ctx do
    owner = hold_operation(ctx.server.id, :backup)

    assert {:error, {:operation_in_progress, :backup}} =
             Servers.delete_server(ctx.scope, ctx.server.id)

    assert {:ok, _server} = Servers.get_server(ctx.scope, ctx.server.id)
    assert File.dir?(ctx.server.directory)
    release_operation(owner)
  end

  test "properties conflict leaves the file unchanged", ctx do
    owner = hold_operation(ctx.server.id, :migration)
    properties_path = Path.join(ctx.server.directory, "server.properties")

    assert {:error, {:operation_in_progress, :migration}} =
             Servers.put_properties_raw(ctx.scope, ctx.server.id, "server-port=25566\n")

    assert File.read!(properties_path) == "server-port=25565\n"
    release_operation(owner)
  end

  test "read-only file access remains available while an operation owns the server", ctx do
    owner = hold_operation(ctx.server.id, :restore)

    assert {:ok, %{content: "server-port=25565\n"}} =
             Servers.read_file(ctx.scope, ctx.server.id, "server.properties", :utf8)

    release_operation(owner)
  end

  test "icon processing does not begin during another operation", ctx do
    owner = hold_operation(ctx.server.id, :delete)

    assert {:error, {:operation_in_progress, :delete}} =
             Servers.store_icon(ctx.scope, ctx.server.id, <<0, 1, 2>>)

    refute File.exists?(Path.join(ctx.server.directory, "server-icon.png"))
    release_operation(owner)
  end

  test "a composite operation can create a backup reentrantly", ctx do
    assert {:ok, backup} =
             OperationLock.run(ctx.server.id, :import, fn ->
               Backups.create_backup(ctx.scope, ctx.server.id, "pre-import",
                 data_dir: ctx.data_dir
               )
             end)

    assert backup.status == "completed"
    assert File.exists?(Path.join([ctx.data_dir, "backups", backup.filename]))
  end

  defp hold_operation(server_id, operation) do
    test_pid = self()

    task =
      Task.async(fn ->
        OperationLock.run(server_id, operation, fn ->
          send(test_pid, {:operation_acquired, self()})

          receive do
            :release_operation -> :released
          end
        end)
      end)

    assert_receive {:operation_acquired, owner_pid}
    on_exit(fn -> Process.exit(task.pid, :kill) end)
    %{task: task, owner_pid: owner_pid}
  end

  defp release_operation(%{task: task, owner_pid: owner_pid}) do
    send(owner_pid, :release_operation)
    assert :released = Task.await(task)
  end
end
