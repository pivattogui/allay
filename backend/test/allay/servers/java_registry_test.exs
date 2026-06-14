defmodule Allay.Servers.JavaRegistryTest do
  # async: false — single named Agent holding global state.
  use ExUnit.Case, async: false

  alias Allay.Servers.JavaRegistry

  setup do
    JavaRegistry.put(%{})
    on_exit(fn -> JavaRegistry.put(%{}) end)
    :ok
  end

  test "put/1 and runtimes/0 round-trip the map" do
    JavaRegistry.put(%{21 => "/opt/java/21/bin/java"})
    assert JavaRegistry.runtimes() == %{21 => "/opt/java/21/bin/java"}
  end

  test "find_compatible/1 delegates to JavaRuntime with the stored map" do
    JavaRegistry.put(%{21 => "/a", 25 => "/b"})

    assert {21, "/a"} = JavaRegistry.find_compatible(21)
    # forward-fall: no exact 22, picks the lowest greater major
    assert {25, "/b"} = JavaRegistry.find_compatible(22)
    assert JavaRegistry.find_compatible(26) == nil
  end

  test "find_compatible/1 on an empty registry is nil" do
    assert JavaRegistry.find_compatible(21) == nil
  end
end
