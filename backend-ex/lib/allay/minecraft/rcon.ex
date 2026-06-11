defmodule Allay.Minecraft.Rcon do
  @moduledoc """
  Minimal RCON client (Valve protocol as implemented by Minecraft).
  Synchronous request/response over a passive :gen_tcp socket — the
  Runtime layer owns concurrency and reconnection policy.

  ## Error handling and desync

  Any `{:error, _}` returned from `exec/2` (timeout, malformed packet,
  closed connection) leaves the socket in an unknown state — the caller
  MUST close and reconnect; `close/1` is always safe to call, even after
  an error.

  Responses larger than one packet (~4 KiB) are truncated by design
  until the runtime layer needs full multi-packet reassembly.
  """

  @auth_type 3
  @exec_type 2
  @default_timeout 5_000

  # A fixed request id is safe for this synchronous client: each send is
  # immediately followed by a matching recv before the next send, and
  # Minecraft echoes back whatever id it received. Unique ids matter only
  # for multiplexed (pipelined) protocols.
  @request_id 1

  defstruct [:socket, :timeout]

  def encode_packet(id, type, body)
      when is_integer(id) and is_integer(type) and is_binary(body) do
    payload = <<id::32-signed-little, type::32-signed-little, body::binary, 0, 0>>
    <<byte_size(payload)::32-signed-little, payload::binary>>
  end

  # Minimum valid payload: 4 (id) + 4 (type) + 2 (null terminators) = 10 bytes.
  # A length below 10 is structurally impossible; reject it instead of
  # recursing forever trying to receive more bytes.
  def decode_packet(<<length::32-signed-little, _rest::binary>>) when length < 10,
    do: {:error, :malformed_packet}

  def decode_packet(<<length::32-signed-little, rest::binary>>)
      when byte_size(rest) >= length do
    <<payload::binary-size(length), remainder::binary>> = rest
    <<id::32-signed-little, type::32-signed-little, body_z::binary>> = payload
    body = String.trim_trailing(body_z, <<0>>)
    {:ok, %{id: id, type: type, body: body}, remainder}
  end

  def decode_packet(_partial), do: :incomplete

  def connect(host, port, password, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, @default_timeout)
    host_charlist = String.to_charlist(host)

    case :gen_tcp.connect(host_charlist, port, [:binary, active: false], timeout) do
      {:error, _} = error ->
        error

      {:ok, socket} ->
        conn = %__MODULE__{socket: socket, timeout: timeout}

        case request(conn, @auth_type, password) do
          {:ok, response} when response.id != -1 ->
            {:ok, conn}

          {:ok, _rejected} ->
            :gen_tcp.close(socket)
            {:error, :auth_failed}

          {:error, _} = error ->
            :gen_tcp.close(socket)
            error
        end
    end
  end

  def exec(%__MODULE__{} = conn, command) when is_binary(command) do
    with {:ok, response} <- request(conn, @exec_type, command) do
      {:ok, response.body}
    end
  end

  def close(%__MODULE__{socket: socket}), do: :gen_tcp.close(socket)

  defp request(%__MODULE__{socket: socket, timeout: timeout}, type, body) do
    with :ok <- :gen_tcp.send(socket, encode_packet(@request_id, type, body)) do
      recv_packet(socket, timeout, "")
    end
  end

  defp recv_packet(socket, timeout, buffer) do
    case decode_packet(buffer) do
      {:ok, packet, _rest} ->
        {:ok, packet}

      {:error, :malformed_packet} = error ->
        error

      :incomplete ->
        with {:ok, data} <- :gen_tcp.recv(socket, 0, timeout) do
          recv_packet(socket, timeout, buffer <> data)
        end
    end
  end
end
