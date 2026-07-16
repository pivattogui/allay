defmodule Allay.Servers.OperationLockTest do
  use ExUnit.Case, async: true

  alias Allay.Servers.OperationLock

  test "runs an operation when the server is free and releases it afterward" do
    server_id = Ecto.UUID.generate()

    assert :first = OperationLock.run(server_id, :backup, fn -> :first end)
    assert :second = OperationLock.run(server_id, :restore, fn -> :second end)
  end

  test "returns the active operation when another process owns the server" do
    server_id = Ecto.UUID.generate()
    owner = hold_lock(server_id, :backup)

    assert {:error, {:operation_in_progress, :backup}} =
             OperationLock.run(server_id, :restore, fn -> :unexpected end)

    release_lock(owner)
  end

  test "allows different servers to execute concurrently" do
    owner = hold_lock(Ecto.UUID.generate(), :backup)

    assert :ok = OperationLock.run(Ecto.UUID.generate(), :restore, fn -> :ok end)

    release_lock(owner)
  end

  test "allows reentrancy in the owner process without releasing the outer lock" do
    server_id = Ecto.UUID.generate()

    assert :outer =
             OperationLock.run(server_id, :import, fn ->
               assert :inner = OperationLock.run(server_id, :backup, fn -> :inner end)

               competitor =
                 Task.async(fn ->
                   OperationLock.run(server_id, :restore, fn -> :unexpected end)
                 end)

               assert {:error, {:operation_in_progress, :import}} = Task.await(competitor)
               :outer
             end)

    assert :available = OperationLock.run(server_id, :backup, fn -> :available end)
  end

  test "releases ownership after an exception" do
    server_id = Ecto.UUID.generate()

    assert_raise RuntimeError, "failure", fn ->
      OperationLock.run(server_id, :backup, fn -> raise "failure" end)
    end

    assert :available = OperationLock.run(server_id, :restore, fn -> :available end)
  end

  test "releases ownership when the owner process is killed" do
    server_id = Ecto.UUID.generate()
    owner = hold_lock(server_id, :backup)

    Task.shutdown(owner.task, :brutal_kill)

    assert :available = OperationLock.run(server_id, :restore, fn -> :available end)
  end

  test "normalizes UUID case" do
    server_id = Ecto.UUID.generate()
    owner = hold_lock(String.upcase(server_id), :migration)

    assert {:error, {:operation_in_progress, :migration}} =
             OperationLock.run(server_id, :delete, fn -> :unexpected end)

    release_lock(owner)
  end

  defp hold_lock(server_id, operation) do
    test_pid = self()

    task =
      Task.async(fn ->
        OperationLock.run(server_id, operation, fn ->
          send(test_pid, {:lock_acquired, self()})

          receive do
            :release_lock -> :released
          end
        end)
      end)

    assert_receive {:lock_acquired, owner_pid}
    %{task: task, owner_pid: owner_pid}
  end

  defp release_lock(%{task: task, owner_pid: owner_pid}) do
    send(owner_pid, :release_lock)
    assert :released = Task.await(task)
  end
end
