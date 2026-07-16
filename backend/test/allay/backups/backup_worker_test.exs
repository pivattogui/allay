defmodule Allay.Backups.BackupWorkerTest do
  use Allay.DataCase, async: false
  use Oban.Testing, repo: Allay.Repo

  import Allay.ServersFixtures

  alias Allay.Backups.Backup
  alias Allay.Backups.BackupWorker
  alias Allay.Repo

  # Builds a tmp data_dir with a minimal server tree, points the row at it, and
  # overrides the configured :data_dir so the worker (which calls create_backup
  # without opts) writes there.
  defp seed_server do
    data_dir = Path.join(System.tmp_dir!(), "allay_bw_#{System.unique_integer([:positive])}")
    server = server_fixture()
    dir = Path.join([data_dir, "servers", server.id])
    File.mkdir_p!(Path.join(dir, "world"))
    File.write!(Path.join([dir, "world", "level.dat"]), "data")
    server = Repo.update!(Ecto.Changeset.change(server, directory: dir))

    previous = Application.get_env(:allay, :data_dir)
    Application.put_env(:allay, :data_dir, data_dir)

    on_exit(fn ->
      File.rm_rf(data_dir)
      Application.put_env(:allay, :data_dir, previous)
    end)

    {server, data_dir}
  end

  test "cancels when the server row is gone" do
    assert {:cancel, :server_deleted} =
             perform_job(BackupWorker, %{
               "server_id" => Ecto.UUID.generate(),
               "type" => "scheduled"
             })
  end

  test "creates a scheduled backup for an existing server" do
    {server, _data_dir} = seed_server()

    assert :ok =
             perform_job(BackupWorker, %{"server_id" => server.id, "type" => "scheduled"})

    assert [%Backup{type: "scheduled", status: "completed"}] =
             Repo.all(Backup) |> Enum.filter(&(&1.server_id == server.id))
  end
end
