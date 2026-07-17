defmodule Allay.Servers.RuntimeBridgeTest do
  use ExUnit.Case, async: false

  alias Allay.Runtime.Spec
  alias Allay.Servers.JavaRegistry
  alias Allay.Servers.RuntimeBridge
  alias Allay.Servers.Server

  setup do
    JavaRegistry.put(%{})

    base =
      Path.join(System.tmp_dir!(), "runtime-bridge-jdks-#{System.unique_integer([:positive])}")

    runtimes =
      for major <- [17, 21, 25], into: %{} do
        bin = Path.join([base, "java-#{major}", "bin"])
        File.mkdir_p!(bin)
        java = Path.join(bin, "java")
        File.write!(java, "#!/bin/sh\necho 'openjdk version \"#{major}.0.1\"' >&2\n")
        File.chmod!(java, 0o755)
        {major, java}
      end

    on_exit(fn ->
      JavaRegistry.put(%{})
      File.rm_rf!(base)
    end)

    %{java17: runtimes[17], java21: runtimes[21], java25: runtimes[25]}
  end

  defp server(attrs) do
    base = %Server{
      id: Ecto.UUID.generate(),
      directory: "/data/servers/x",
      ram_min_mb: 1024,
      ram_max_mb: 2048,
      jvm_args: nil,
      java_path: nil,
      java_version: nil,
      auto_restart: false,
      restart_limit: 3,
      rcon_port: 35_565,
      rcon_password: "pw"
    }

    struct(base, attrs)
  end

  describe "resolver policy" do
    test "row 1: java_path override wins even when registry has matches", %{java21: java21} do
      JavaRegistry.put(%{21 => java21})
      srv = server(java_path: java21, java_version: "21")

      assert {:ok, %Spec{java_bin: ^java21}} = RuntimeBridge.build_spec(srv)
    end

    test "row 1: java_path override wins with an EMPTY registry", %{java21: java21} do
      JavaRegistry.put(%{})
      srv = server(java_path: java21, java_version: "21")

      assert {:ok, %Spec{java_bin: ^java21}} = RuntimeBridge.build_spec(srv)
    end

    test "row 1: unavailable java_path blocks startup" do
      srv = server(java_path: "/missing/java", java_version: "21")

      assert {:error, {:java_runtime_unavailable, message}} = RuntimeBridge.build_spec(srv)
      assert message =~ "/missing/java"
    end

    test "row 1: empty-string java_path is treated as absent", %{java21: java21} do
      JavaRegistry.put(%{21 => java21})
      srv = server(java_path: "", java_version: "21")

      assert {:ok, %Spec{java_bin: ^java21}} = RuntimeBridge.build_spec(srv)
    end

    test "row 2: registry exact match", %{java21: java21} do
      JavaRegistry.put(%{21 => java21})
      srv = server(java_path: nil, java_version: "21")

      assert {:ok, %Spec{java_bin: ^java21}} = RuntimeBridge.build_spec(srv)
    end

    test "row 2: registry forward-fall to a higher major", %{java25: java25} do
      JavaRegistry.put(%{25 => java25})
      srv = server(java_path: nil, java_version: "21")

      assert {:ok, %Spec{java_bin: ^java25}} = RuntimeBridge.build_spec(srv)
    end

    test "row 2: stale lower major is ignored and startup is rejected", %{
      java17: java17
    } do
      JavaRegistry.put(%{17 => java17})
      srv = server(java_path: nil, java_version: "21")

      assert {:error, {:java_runtime_unavailable, msg}} = RuntimeBridge.build_spec(srv)
      assert msg =~ "none"
    end

    test "row 2: unavailable message lists \"none\" when registry empty" do
      JavaRegistry.put(%{})
      srv = server(java_path: nil, java_version: "21")

      assert {:error, {:java_runtime_unavailable, msg}} = RuntimeBridge.build_spec(srv)
      assert msg =~ "none"
    end

    test "row 3: java_version nil → java_runtime_unavailable" do
      JavaRegistry.put(%{21 => "/registry/java21"})
      srv = server(java_path: nil, java_version: nil)

      assert {:error, {:java_runtime_unavailable, _msg}} = RuntimeBridge.build_spec(srv)
    end

    test "row 3: unparseable java_version → java_runtime_unavailable" do
      JavaRegistry.put(%{21 => "/registry/java21"})
      srv = server(java_path: nil, java_version: "not-a-number")

      assert {:error, {:java_runtime_unavailable, _msg}} = RuntimeBridge.build_spec(srv)
    end
  end

  describe "spec field mapping" do
    test "maps every row field into the Spec", %{java21: java21} do
      JavaRegistry.put(%{})

      srv =
        server(
          java_path: java21,
          directory: "/data/servers/abc",
          ram_min_mb: 512,
          ram_max_mb: 4096,
          jvm_args: "-XX:+UseG1GC",
          auto_restart: true,
          restart_limit: 5,
          rcon_port: 45_678,
          rcon_password: "secret"
        )

      assert {:ok, spec} = RuntimeBridge.build_spec(srv)
      assert spec.server_id == srv.id
      assert spec.directory == "/data/servers/abc"
      assert spec.java_bin == java21
      assert spec.ram_min_mb == 512
      assert spec.ram_max_mb == 4096
      assert spec.jvm_args == "-XX:+UseG1GC"
      assert spec.rcon_host == "127.0.0.1"
      assert spec.rcon_port == 45_678
      assert spec.rcon_password == "secret"
      assert spec.auto_restart == %{enabled?: true, limit: 5, window_ms: 600_000}
    end

    test "nil jvm_args becomes an empty string", %{java21: java21} do
      srv = server(java_path: java21, jvm_args: nil)
      assert {:ok, %Spec{jvm_args: ""}} = RuntimeBridge.build_spec(srv)
    end

    test "spec_overrides opts merge into the struct (test seam)", %{java21: java21} do
      srv = server(java_path: java21)

      assert {:ok, spec} =
               RuntimeBridge.build_spec(srv,
                 spec_overrides: [rcon_mod: Allay.Runtime.FakeRcon, startup_timeout_ms: 2_000]
               )

      assert spec.rcon_mod == Allay.Runtime.FakeRcon
      assert spec.startup_timeout_ms == 2_000
    end
  end
end
