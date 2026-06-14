defmodule Allay.Runtime.Event do
  @moduledoc """
  The only message shape that crosses the runtime boundary over PubSub.
  type :log → data is a LogLine map; :status → %{state, pid, uptime,
  last_error}; :metrics → the sampler payload.
  """

  @enforce_keys [:server_id, :type, :data]
  defstruct @enforce_keys

  def topic(server_id), do: "runtime:server:#{server_id}"

  def broadcast(server_id, type, data) do
    Phoenix.PubSub.broadcast(
      Allay.PubSub,
      topic(server_id),
      %__MODULE__{server_id: server_id, type: type, data: data}
    )
  end
end
