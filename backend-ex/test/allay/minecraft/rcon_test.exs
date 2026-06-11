defmodule Allay.Minecraft.RconTest do
  use ExUnit.Case, async: true

  alias Allay.Minecraft.Rcon

  describe "packet framing (pure)" do
    test "encodes a packet with size prefix and double null terminator" do
      packet = Rcon.encode_packet(7, 3, "secret")

      assert packet ==
               <<16::32-signed-little, 7::32-signed-little, 3::32-signed-little, "secret", 0, 0>>
    end

    test "decodes its own encoding" do
      assert {:ok, %{id: 9, type: 0, body: "Done"}, ""} =
               9 |> Rcon.encode_packet(0, "Done") |> Rcon.decode_packet()
    end

    test "decode returns :incomplete for partial data and keeps the rest" do
      full = Rcon.encode_packet(1, 0, "hello")
      partial = binary_part(full, 0, byte_size(full) - 3)

      assert :incomplete = Rcon.decode_packet(partial)

      two = full <> Rcon.encode_packet(2, 0, "world")
      assert {:ok, %{id: 1, body: "hello"}, rest} = Rcon.decode_packet(two)
      assert {:ok, %{id: 2, body: "world"}, ""} = Rcon.decode_packet(rest)
    end
  end

  describe "against a fake RCON server" do
    setup do
      {:ok, listen} = :gen_tcp.listen(0, [:binary, active: false, reuseaddr: true])
      {:ok, port} = :inet.port(listen)

      server =
        Task.async(fn ->
          {:ok, socket} = :gen_tcp.accept(listen, 5_000)
          serve(socket, "hunter2")
        end)

      on_exit(fn -> :gen_tcp.close(listen) end)
      %{port: port, server: server}
    end

    defp serve(socket, password) do
      with {:ok, data} <- :gen_tcp.recv(socket, 0, 5_000),
           {:ok, %{id: id, type: 3, body: ^password}, _} <- Rcon.decode_packet(data) do
        :gen_tcp.send(socket, Rcon.encode_packet(id, 2, ""))
        loop(socket)
      else
        {:ok, %{id: _id, type: 3}, _} ->
          :gen_tcp.send(socket, Rcon.encode_packet(-1, 2, ""))

        _ ->
          :ok
      end
    end

    defp loop(socket) do
      case :gen_tcp.recv(socket, 0, 5_000) do
        {:ok, data} ->
          {:ok, %{id: id, type: 2, body: body}, _} = Rcon.decode_packet(data)
          :gen_tcp.send(socket, Rcon.encode_packet(id, 0, "echo: " <> body))
          loop(socket)

        _ ->
          :ok
      end
    end

    test "connects, authenticates and executes commands", %{port: port} do
      assert {:ok, conn} = Rcon.connect("127.0.0.1", port, "hunter2", timeout: 2_000)
      assert {:ok, "echo: list"} = Rcon.exec(conn, "list")
      assert {:ok, "echo: save-all"} = Rcon.exec(conn, "save-all")
      assert :ok = Rcon.close(conn)
    end

    test "wrong password is rejected", %{port: port} do
      assert {:error, :auth_failed} = Rcon.connect("127.0.0.1", port, "wrong", timeout: 2_000)
    end

    test "connection refused surfaces as an error" do
      assert {:error, _reason} = Rcon.connect("127.0.0.1", 1, "x", timeout: 500)
    end
  end
end
