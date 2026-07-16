defmodule Allay.Servers.ProvisionerTest do
  # async: false — the shared JavaRegistry Agent holds global state we mutate
  # per-test via put/1.
  use Allay.DataCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Backups.BackupConfig
  alias Allay.Minecraft.Properties
  alias Allay.Servers.JavaRegistry
  alias Allay.Servers.Provisioner
  alias Allay.Servers.Server

  @jar_bytes "PK fake server jar bytes"

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

  defp scope do
    user = user_fixture()
    Accounts.Scope.for_user(user)
  end

  defp valid_attrs(overrides \\ %{}) do
    Map.merge(
      %{
        name: "My Server",
        type: "vanilla",
        version: "1.21.11",
        port: 25_565,
        ram_min_mb: 1024,
        ram_max_mb: 2048
      },
      overrides
    )
  end

  # Routes the Mojang manifest, version metadata, and jar bytes. Optional
  # status overrides let a test force a 404 manifest or a 500 jar.
  defp stub_minecraft(opts \\ []) do
    manifest_status = Keyword.get(opts, :manifest_status, 200)
    jar_status = Keyword.get(opts, :jar_status, 200)

    Req.Test.stub(Allay.Minecraft.APIStub, fn conn ->
      route(conn, manifest_status, jar_status)
    end)
  end

  defp route(%{host: "launchermeta.mojang.com"} = conn, 200, _jar),
    do: Req.Test.json(conn, @manifest)

  defp route(%{host: "launchermeta.mojang.com"} = conn, status, _jar),
    do: Plug.Conn.send_resp(conn, status, "nope")

  defp route(%{host: "piston-meta.example"} = conn, _manifest, _jar),
    do: Req.Test.json(conn, @meta)

  defp route(%{host: "piston-data.example"} = conn, _manifest, 200),
    do: Plug.Conn.send_resp(conn, 200, @jar_bytes)

  defp route(%{host: "piston-data.example"} = conn, _manifest, status),
    do: Plug.Conn.send_resp(conn, status, "boom")

  defp route(conn, _manifest, _jar),
    do: Plug.Conn.send_resp(conn, 404, "not stubbed: #{inspect({conn.host, conn.request_path})}")

  setup do
    data_dir = Path.join(System.tmp_dir!(), "provision-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(data_dir) end)

    # Default: Java 21 is installed. Individual tests override.
    JavaRegistry.put(%{21 => "/fake/java21/bin/java"})
    on_exit(fn -> JavaRegistry.put(%{}) end)

    %{data_dir: data_dir}
  end

  describe "provision/3 happy path" do
    test "inserts the row with RCON columns and lays out the disk", %{data_dir: data_dir} do
      stub_minecraft()

      assert {:ok, %Server{} = server} =
               Provisioner.provision(scope(), valid_attrs(), data_dir: data_dir)

      assert server.java_version == "21"
      assert server.rcon_port == 25_565 + 10_000
      assert is_binary(server.rcon_password)
      # 18 random bytes url-encoded ≈ 24 chars
      assert String.length(server.rcon_password) >= 24

      directory = Path.join([data_dir, "servers", server.id])
      assert server.directory == directory

      assert File.read!(Path.join(directory, "server.jar")) == @jar_bytes
      assert File.read!(Path.join(directory, "eula.txt")) == "eula=true\n"

      props = Path.join(directory, "server.properties") |> File.read!() |> Properties.parse()

      assert props == %{
               "server-port" => "25565",
               "enable-rcon" => "true",
               "rcon.port" => to_string(server.rcon_port),
               "rcon.password" => server.rcon_password
             }
    end

    test "creates a backup_config row with defaults", %{data_dir: data_dir} do
      stub_minecraft()

      assert {:ok, server} = Provisioner.provision(scope(), valid_attrs(), data_dir: data_dir)

      assert config = Repo.get_by(BackupConfig, server_id: server.id)
      assert config.enabled == true
      assert config.interval_minutes == 60
      assert config.max_backups == 10
      assert config.include_logs == false
    end
  end

  describe "provision/3 java gate" do
    test "java runtime unavailable: error mentions required major and 'none', no dir created",
         %{data_dir: data_dir} do
      stub_minecraft()
      JavaRegistry.put(%{})

      assert {:error, {:java_runtime_unavailable, message}} =
               Provisioner.provision(scope(), valid_attrs(), data_dir: data_dir)

      assert message =~ "requires Java 21"
      assert message =~ "none"

      refute File.exists?(Path.join(data_dir, "servers"))
    end

    test "java lookup failure (404 manifest) returns :java_lookup_failed", %{data_dir: data_dir} do
      stub_minecraft(manifest_status: 404)

      assert {:error, {:java_lookup_failed, message}} =
               Provisioner.provision(scope(), valid_attrs(), data_dir: data_dir)

      assert is_binary(message)
      refute File.exists?(Path.join(data_dir, "servers"))
    end
  end

  describe "provision/3 failures" do
    test "jar download failure (500) returns :provision_failed and creates no server dir",
         %{data_dir: data_dir} do
      stub_minecraft(jar_status: 500)

      assert {:error, {:provision_failed, message}} =
               Provisioner.provision(scope(), valid_attrs(), data_dir: data_dir)

      assert is_binary(message)
      refute File.exists?(Path.join(data_dir, "servers"))
    end

    test "DB uniqueness race maps to :port_in_use and cleans up the created directory",
         %{data_dir: data_dir} do
      stub_minecraft()
      # Pre-existing row holding port 25565 forces the Multi insert to fail.
      server_fixture(%{port: 25_565, rcon_port: 99_565})

      assert {:error, :port_in_use} =
               Provisioner.provision(scope(), valid_attrs(%{port: 25_565}), data_dir: data_dir)

      # No orphan directory left behind.
      assert File.ls!(Path.join(data_dir, "servers")) == []
    end

    test "invalid changeset short-circuits before the java gate", %{data_dir: data_dir} do
      # Java gate would hit the stub; make the stub raise so any gate call fails
      # the test loudly. An invalid changeset must return before touching it.
      Req.Test.stub(Allay.Minecraft.APIStub, fn _conn ->
        raise "java gate must not run for an invalid changeset"
      end)

      assert {:error, %Ecto.Changeset{}} =
               Provisioner.provision(scope(), valid_attrs(%{name: ""}), data_dir: data_dir)

      refute File.exists?(Path.join(data_dir, "servers"))
    end
  end
end
