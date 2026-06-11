defmodule Allay.Runtime.FakeRcon do
  @moduledoc """
  Injectable rcon_mod for ServerRuntime tests. Readiness and exec
  behavior are toggled per rcon_port through a shared Agent, letting
  tests simulate "server not ready yet", auth success, and stop
  commands without real TCP (the protocol itself is tested in
  Allay.Minecraft.RconTest).
  """

  def start_registry do
    case Agent.start_link(fn -> %{} end, name: __MODULE__) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
    end
  end

  def set(port, config), do: Agent.update(__MODULE__, &Map.put(&1, port, config))

  defp get(port), do: Agent.get(__MODULE__, &Map.get(&1, port, %{ready?: false}))

  # rcon_mod contract used by ServerRuntime:
  def connect(_host, port, _password, _opts) do
    if get(port).ready?, do: {:ok, {:fake_conn, port}}, else: {:error, :econnrefused}
  end

  def exec({:fake_conn, port}, command) do
    case get(port) do
      %{on_exec: fun} -> fun.(command)
      _ -> {:ok, ""}
    end
  end

  def close({:fake_conn, _port}), do: :ok
end
