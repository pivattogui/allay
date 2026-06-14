defmodule Allay.Test.StubRuntime do
  @moduledoc """
  Test seam for `Allay.Backups`: a drop-in for `Allay.Runtime` that lets
  backup tests pick the running/stopped branch and capture the console
  command sequence (save-off / save-all / save-on) without a live JVM.

  `Allay.Backups.create_backup/4` accepts `opts[:runtime]` (default
  `Allay.Runtime`). The stub runs in the test process, so it reads its
  configured `:state` and reporting pid from that process's dictionary,
  seeded by `install/1`.
  """

  @doc """
  Installs stub config (target state + reporting pid) for the current test
  process and returns the module to pass as `opts[:runtime]`.
  """
  def install(state) do
    Process.put(:stub_runtime_state, state)
    Process.put(:stub_runtime_owner, self())
    __MODULE__
  end

  def status(_id), do: %{state: Process.get(:stub_runtime_state, :stopped)}

  def send_command(id, command) do
    owner = Process.get(:stub_runtime_owner)
    if owner, do: send(owner, {:stub_command, id, command})
    {:ok, ""}
  end
end
