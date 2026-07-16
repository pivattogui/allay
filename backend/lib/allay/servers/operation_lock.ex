defmodule Allay.Servers.OperationLock do
  @moduledoc """
  Node-local, fail-fast serialization for operations that mutate one server.

  Ownership belongs to the calling process and is reentrant only for that
  process. Registry removes ownership automatically if the owner terminates.
  """

  @registry Allay.Servers.OperationRegistry

  @type operation ::
          :backup
          | :restore
          | :import
          | :migration
          | :delete
          | :file_write
          | :configuration
          | :lifecycle

  @type conflict :: {:error, {:operation_in_progress, operation() | :unknown}}

  @spec run(String.t(), operation(), (-> term())) :: term() | conflict()
  def run(server_id, operation, operation_fun)
      when is_binary(server_id) and is_function(operation_fun, 0) do
    key = operation_key(server_id)

    case Registry.register(@registry, key, operation) do
      {:ok, _owner} ->
        run_as_owner(key, operation_fun)

      {:error, {:already_registered, owner_pid}} when owner_pid == self() ->
        operation_fun.()

      {:error, {:already_registered, _owner_pid}} ->
        {:error, {:operation_in_progress, active_operation(key)}}
    end
  end

  defp run_as_owner(key, operation_fun) do
    operation_fun.()
  after
    Registry.unregister(@registry, key)
  end

  defp active_operation(key) do
    case Registry.lookup(@registry, key) do
      [{_owner_pid, operation}] -> operation
      [] -> :unknown
    end
  end

  defp operation_key(server_id) do
    {:server_operation, String.downcase(server_id)}
  end
end
