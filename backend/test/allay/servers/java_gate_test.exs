defmodule Allay.Servers.JavaGateTest do
  # async: false — depends on the shared JavaRegistry Agent.
  use ExUnit.Case, async: false

  alias Allay.Servers.JavaGate
  alias Allay.Servers.JavaRegistry

  @manifest %{
    "versions" => [
      %{"id" => "1.21.11", "type" => "release", "url" => "https://piston-meta.example/v.json"}
    ]
  }

  @meta %{"javaVersion" => %{"majorVersion" => 21}, "downloads" => %{}}

  defp stub(opts \\ []) do
    manifest_status = Keyword.get(opts, :manifest_status, 200)

    Req.Test.stub(Allay.Minecraft.APIStub, fn conn ->
      route(conn, manifest_status)
    end)
  end

  defp route(%{host: "launchermeta.mojang.com"} = conn, 200), do: Req.Test.json(conn, @manifest)

  defp route(%{host: "launchermeta.mojang.com"} = conn, status),
    do: Plug.Conn.send_resp(conn, status, "nope")

  defp route(%{host: "piston-meta.example"} = conn, _manifest), do: Req.Test.json(conn, @meta)

  defp route(conn, _manifest),
    do: Plug.Conn.send_resp(conn, 404, "not stubbed: #{inspect({conn.host, conn.request_path})}")

  setup do
    JavaRegistry.put(%{})
    on_exit(fn -> JavaRegistry.put(%{}) end)
    :ok
  end

  describe "required_major/2" do
    test "wraps the resolved major in {:ok, major}" do
      stub()
      assert {:ok, 21} = JavaGate.required_major("vanilla", "1.21.11")
    end

    test "lookup failure becomes {:error, {:java_lookup_failed, _}}" do
      stub(manifest_status: 404)

      assert {:error, {:java_lookup_failed, message}} =
               JavaGate.required_major("vanilla", "1.21.11")

      assert is_binary(message)
    end
  end

  describe "assert_available/2" do
    test "hit returns {:ok, major}" do
      stub()
      JavaRegistry.put(%{21 => "/fake/java"})
      assert {:ok, 21} = JavaGate.assert_available("vanilla", "1.21.11")
    end

    test "miss with no runtimes lists 'none' in the message" do
      stub()

      assert {:error, {:java_runtime_unavailable, message}} =
               JavaGate.assert_available("vanilla", "1.21.11")

      assert message =~ "Server vanilla/1.21.11 requires Java 21"
      assert message =~ "none"
    end

    test "miss with other runtimes lists the installed majors" do
      stub()
      JavaRegistry.put(%{17 => "/j17"})

      assert {:error, {:java_runtime_unavailable, message}} =
               JavaGate.assert_available("vanilla", "1.21.11")

      assert message =~ "17"
      refute message =~ "none"
    end

    test "propagates lookup failures unchanged" do
      stub(manifest_status: 404)
      assert {:error, {:java_lookup_failed, _}} = JavaGate.assert_available("vanilla", "1.21.11")
    end
  end
end
