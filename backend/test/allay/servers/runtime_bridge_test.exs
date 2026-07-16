defmodule Allay.Servers.RuntimeBridgeTest do
  use ExUnit.Case, async: false

  alias Allay.Runtime.Spec
  alias Allay.Servers.JavaRegistry
  alias Allay.Servers.RuntimeBridge
  alias Allay.Servers.Server

  setup do
    JavaRegistry.put(%{})
    on_exit(fn -> JavaRegistry.put(%{}) end)
    :ok
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
    test "row 1: java_path override wins even when registry has matches" do
      JavaRegistry.put(%{21 => "/registry/java21"})
      srv = server(java_path: "/custom/java", java_version: "21")

      assert {:ok, %Spec{java_bin: "/custom/java"}} = RuntimeBridge.build_spec(srv)
    end

    test "row 1: java_path override wins with an EMPTY registry" do
      JavaRegistry.put(%{})
      srv = server(java_path: "/custom/java", java_version: "21")

      assert {:ok, %Spec{java_bin: "/custom/java"}} = RuntimeBridge.build_spec(srv)
    end

    test "row 1: empty-string java_path is treated as absent" do
      JavaRegistry.put(%{21 => "/registry/java21"})
      srv = server(java_path: "", java_version: "21")

      assert {:ok, %Spec{java_bin: "/registry/java21"}} = RuntimeBridge.build_spec(srv)
    end

    test "row 2: registry exact match" do
      JavaRegistry.put(%{21 => "/registry/java21"})
      srv = server(java_path: nil, java_version: "21")

      assert {:ok, %Spec{java_bin: "/registry/java21"}} = RuntimeBridge.build_spec(srv)
    end

    test "row 2: registry forward-fall to a higher major" do
      JavaRegistry.put(%{25 => "/registry/java25"})
      srv = server(java_path: nil, java_version: "21")

      assert {:ok, %Spec{java_bin: "/registry/java25"}} = RuntimeBridge.build_spec(srv)
    end

    test "row 2: pinned major missing → java_runtime_unavailable, never falls back" do
      JavaRegistry.put(%{17 => "/registry/java17"})
      srv = server(java_path: nil, java_version: "21")

      assert {:error, {:java_runtime_unavailable, msg}} = RuntimeBridge.build_spec(srv)
      assert msg =~ "17"
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
    test "maps every row field into the Spec" do
      JavaRegistry.put(%{})

      srv =
        server(
          java_path: "/custom/java",
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
      assert spec.java_bin == "/custom/java"
      assert spec.ram_min_mb == 512
      assert spec.ram_max_mb == 4096
      assert spec.jvm_args == "-XX:+UseG1GC"
      assert spec.rcon_host == "127.0.0.1"
      assert spec.rcon_port == 45_678
      assert spec.rcon_password == "secret"
      assert spec.auto_restart == %{enabled?: true, limit: 5, window_ms: 600_000}
    end

    test "nil jvm_args becomes an empty string" do
      srv = server(java_path: "/custom/java", jvm_args: nil)
      assert {:ok, %Spec{jvm_args: ""}} = RuntimeBridge.build_spec(srv)
    end

    test "spec_overrides opts merge into the struct (test seam)" do
      srv = server(java_path: "/custom/java")

      assert {:ok, spec} =
               RuntimeBridge.build_spec(srv,
                 spec_overrides: [rcon_mod: Allay.Runtime.FakeRcon, startup_timeout_ms: 2_000]
               )

      assert spec.rcon_mod == Allay.Runtime.FakeRcon
      assert spec.startup_timeout_ms == 2_000
    end
  end
end
