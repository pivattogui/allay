defmodule Allay.Minecraft.JarCacheTest do
  use ExUnit.Case, async: true

  alias Allay.Minecraft.JarCache

  @jar_bytes "PK fake jar bytes"
  @jar_sha1 :crypto.hash(:sha, "PK fake jar bytes") |> Base.encode16(case: :lower)

  setup do
    dir = Path.join(System.tmp_dir!(), "jars-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(dir) end)

    Req.Test.stub(Allay.Minecraft.APIStub, fn conn ->
      Plug.Conn.send_resp(conn, 200, @jar_bytes)
    end)

    %{dir: dir}
  end

  test "downloads, verifies sha1 and caches", %{dir: dir} do
    spec = %{url: "https://piston-data.example/server.jar", sha1: @jar_sha1}

    assert {:ok, path} = JarCache.fetch(:vanilla, "26.1.2", spec, data_dir: dir)
    assert path == Path.join([dir, "jars", "vanilla", "26.1.2.jar"])
    assert File.read!(path) == @jar_bytes
  end

  test "cache hit short-circuits without touching the network", %{dir: dir} do
    path = Path.join([dir, "jars", "paper", "1.21.11.jar"])
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, "cached")

    Req.Test.stub(Allay.Minecraft.APIStub, fn _conn ->
      raise "network must not be hit on cache hit"
    end)

    spec = %{url: "https://api.papermc.io/should-not-be-called", sha1: nil}
    assert {:ok, ^path} = JarCache.fetch(:paper, "1.21.11", spec, data_dir: dir)
    assert File.read!(path) == "cached"
  end

  test "sha1 mismatch fails and leaves no cached file", %{dir: dir} do
    spec = %{url: "https://piston-data.example/server.jar", sha1: "0000000000"}

    assert {:error, message} = JarCache.fetch(:vanilla, "26.1.2", spec, data_dir: dir)
    assert message =~ "sha1"
    refute File.exists?(Path.join([dir, "jars", "vanilla", "26.1.2.jar"]))
  end

  test "nil sha1 skips verification", %{dir: dir} do
    spec = %{url: "https://api.papermc.io/x.jar", sha1: nil}
    assert {:ok, _path} = JarCache.fetch(:paper, "1.21.11", spec, data_dir: dir)
  end

  test "local_path/3 returns the cached path or nil", %{dir: dir} do
    assert JarCache.local_path(:vanilla, "26.1.2", data_dir: dir) == nil

    path = Path.join([dir, "jars", "vanilla", "26.1.2.jar"])
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, "x")

    assert JarCache.local_path(:vanilla, "26.1.2", data_dir: dir) == path
  end
end
