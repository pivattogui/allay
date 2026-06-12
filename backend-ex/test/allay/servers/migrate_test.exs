defmodule Allay.Servers.MigrateTest do
  # async: false — depends on the shared JavaRegistry Agent and the
  # Req.Test APIStub global stub.
  use Allay.DataCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Backups
  alias Allay.Backups.Backup
  alias Allay.Repo
  alias Allay.Servers
  alias Allay.Servers.JavaRegistry
  alias Allay.Test.StubRuntime

  @jar_bytes "PK fake new jar bytes"
  @failing_tar Path.expand("../../support/fake_tar_fail.sh", __DIR__)

  @manifest %{
    "versions" => [
      %{
        "id" => "1.21.11",
        "type" => "release",
        "url" => "https://piston-meta.example/1.21.11.json"
      }
    ]
  }

  @meta %{
    "javaVersion" => %{"majorVersion" => 21},
    "downloads" => %{
      "server" => %{"url" => "https://piston-data.example/server.jar", "sha1" => nil}
    }
  }

  @paper_builds %{"builds" => [%{"build" => 100}]}
  @paper_build_info %{"downloads" => %{"application" => %{"name" => "paper-1.21.11-100.jar"}}}

  defp scope do
    user = user_fixture()
    Accounts.Scope.for_user(user)
  end

  # Stubs all three API surfaces: Mojang manifest + piston-meta (java gate, both
  # types) and papermc builds (paper jar download). Vanilla jar lands on
  # piston-data; paper jar on the papermc downloads path.
  defp stub_apis do
    Req.Test.stub(Allay.Minecraft.APIStub, fn conn ->
      case {conn.host, conn.request_path} do
        {"launchermeta.mojang.com", _} ->
          Req.Test.json(conn, @manifest)

        {"piston-meta.example", _} ->
          Req.Test.json(conn, @meta)

        {"piston-data.example", _} ->
          Plug.Conn.send_resp(conn, 200, @jar_bytes)

        {"api.papermc.io", "/v2/projects/paper/versions/1.21.11/builds"} ->
          Req.Test.json(conn, @paper_builds)

        {"api.papermc.io", "/v2/projects/paper/versions/1.21.11/builds/100"} ->
          Req.Test.json(conn, @paper_build_info)

        {"api.papermc.io", _} ->
          Plug.Conn.send_resp(conn, 200, @jar_bytes)

        _ ->
          Plug.Conn.send_resp(conn, 404, "not stubbed: #{conn.host}#{conn.request_path}")
      end
    end)
  end

  # A server seeded on disk with an old server.jar, ready to migrate.
  defp seeded_server(data_dir, overrides \\ %{}) do
    dir = Path.join([data_dir, "servers", "srv-#{System.unique_integer([:positive])}"])
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "server.jar"), "OLD JAR")

    attrs = Map.merge(%{type: "vanilla", version: "1.21.0", directory: dir}, overrides)
    server_fixture(attrs)
  end

  setup do
    data_dir = Path.join(System.tmp_dir!(), "migrate-#{System.unique_integer([:positive])}")
    File.mkdir_p!(data_dir)
    on_exit(fn -> File.rm_rf!(data_dir) end)

    JavaRegistry.put(%{21 => "/fake/java"})
    on_exit(fn -> JavaRegistry.put(%{}) end)

    %{data_dir: data_dir}
  end

  describe "migrate_server/4 guards" do
    test "rejects an unsupported server type", %{data_dir: data_dir} do
      server = seeded_server(data_dir)

      assert {:error, :invalid_server_type} =
               Servers.migrate_server(scope(), server.id, "forge", "1.21.11", data_dir: data_dir)
    end

    test "404 for an unknown server", %{data_dir: data_dir} do
      assert {:error, :not_found} =
               Servers.migrate_server(
                 scope(),
                 Ecto.UUID.generate(),
                 "paper",
                 "1.21.11",
                 data_dir: data_dir
               )
    end

    test "409 when the server is running", %{data_dir: data_dir} do
      stub_apis()
      server = seeded_server(data_dir)
      runtime = StubRuntime.install(:running)

      assert {:error, :server_running} =
               Servers.migrate_server(scope(), server.id, "paper", "1.21.11",
                 data_dir: data_dir,
                 runtime: runtime
               )
    end

    test "409 when the server is starting", %{data_dir: data_dir} do
      stub_apis()
      server = seeded_server(data_dir)
      runtime = StubRuntime.install(:starting)

      assert {:error, :server_running} =
               Servers.migrate_server(scope(), server.id, "paper", "1.21.11",
                 data_dir: data_dir,
                 runtime: runtime
               )
    end

    test "state guard runs before the java gate (running with no java installed still 409)",
         %{data_dir: data_dir} do
      stub_apis()
      JavaRegistry.put(%{})
      server = seeded_server(data_dir)
      runtime = StubRuntime.install(:running)

      assert {:error, :server_running} =
               Servers.migrate_server(scope(), server.id, "paper", "1.21.11",
                 data_dir: data_dir,
                 runtime: runtime
               )
    end

    test "java gate failure passes through unchanged", %{data_dir: data_dir} do
      stub_apis()
      JavaRegistry.put(%{})
      server = seeded_server(data_dir)

      assert {:error, {:java_runtime_unavailable, _}} =
               Servers.migrate_server(scope(), server.id, "vanilla", "1.21.11",
                 data_dir: data_dir
               )
    end
  end

  describe "migrate_server/4 happy path" do
    test "backs up, swaps the jar, updates the row, returns pre-update values",
         %{data_dir: data_dir} do
      stub_apis()
      server = seeded_server(data_dir, %{type: "vanilla", version: "1.21.0"})

      assert {:ok, result} =
               Servers.migrate_server(scope(), server.id, "paper", "1.21.11", data_dir: data_dir)

      assert %{
               backup_id: backup_id,
               migration: %{
                 from_type: "vanilla",
                 from_version: "1.21.0",
                 to_type: "paper",
                 to_version: "1.21.11"
               }
             } = result

      # New jar copied in over the old one.
      assert File.read!(Path.join(server.directory, "server.jar")) == @jar_bytes

      # Row updated to the target type/version + resolved java major.
      updated = Repo.reload!(server)
      assert updated.type == "paper"
      assert updated.version == "1.21.11"
      assert updated.java_version == "21"

      # A manual backup row exists and matches the returned id.
      backup = Repo.get!(Backup, backup_id)
      assert backup.server_id == server.id
      assert backup.type == "manual"
    end
  end

  describe "migrate_server/4 failure paths" do
    test "backup failure short-circuits before the jar swap (old jar intact)",
         %{data_dir: data_dir} do
      stub_apis()
      server = seeded_server(data_dir)

      assert {:error, {:backup_failed, _}} =
               Servers.migrate_server(scope(), server.id, "paper", "1.21.11",
                 data_dir: data_dir,
                 # Forces the tar >1 branch → backup fails (exit 1 is benign).
                 tar_cmd: @failing_tar
               )

      # Jar swap never happened: the old jar is untouched.
      assert File.read!(Path.join(server.directory, "server.jar")) == "OLD JAR"

      # Row unchanged.
      reloaded = Repo.reload!(server)
      assert reloaded.type == "vanilla"
      assert reloaded.version == "1.21.0"
    end

    test "jar download failure after backup leaves the backup row present and old jar intact",
         %{data_dir: data_dir} do
      # Paper migration: java gate (Mojang manifest + piston-meta) succeeds, but
      # the papermc builds lookup 404s — download_spec fails BEFORE any unlink.
      Req.Test.stub(Allay.Minecraft.APIStub, fn conn ->
        case conn.host do
          "launchermeta.mojang.com" -> Req.Test.json(conn, @manifest)
          "piston-meta.example" -> Req.Test.json(conn, @meta)
          "api.papermc.io" -> Plug.Conn.send_resp(conn, 404, "gone")
          _ -> Plug.Conn.send_resp(conn, 404, "x")
        end
      end)

      scope = scope()
      server = seeded_server(data_dir)

      assert {:error, {:jar_download_failed, _}} =
               Servers.migrate_server(scope, server.id, "paper", "1.21.11", data_dir: data_dir)

      # download_spec failure precedes the unlink: old jar INTACT.
      assert File.read!(Path.join(server.directory, "server.jar")) == "OLD JAR"

      # The pre-migration backup row survives (it is the recovery path).
      assert [%Backup{type: "manual", status: "completed"}] =
               Backups.list_backups(scope, server.id)

      # Row unchanged.
      assert Repo.reload!(server).version == "1.21.0"
    end
  end
end
