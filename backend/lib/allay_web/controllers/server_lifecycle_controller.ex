defmodule AllayWeb.ServerLifecycleController do
  use AllayWeb, :controller

  alias Allay.Servers
  alias AllayWeb.ServerJSON

  action_fallback AllayWeb.FallbackController

  def start(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, status} <- Servers.start_server(scope, id, start_opts()) do
      json(conn, %{message: "Server starting", status: ServerJSON.status(status)})
    end
  end

  def stop(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, status} <- Servers.stop_server_process(scope, id) do
      json(conn, %{message: "Server stopped", status: ServerJSON.status(status)})
    end
  end

  def kill(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, status} <- Servers.kill_server(scope, id) do
      json(conn, %{message: "Server killed", status: ServerJSON.status(status)})
    end
  end

  def command(conn, %{"id" => id} = params) do
    scope = conn.assigns.current_scope
    cmd = Map.get(params, "command")

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, _output} <- Servers.send_command(scope, id, cmd) do
      json(conn, %{message: "Command sent", command: cmd})
    end
  end

  def logs(conn, %{"id" => id} = params) do
    scope = conn.assigns.current_scope
    lines = parse_lines(Map.get(params, "lines"))

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, rendered} <- Servers.server_logs(scope, id, lines) do
      json(conn, %{logs: rendered})
    end
  end

  def status(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, _server} <- fetch_server(scope, id),
         {:ok, status} <- Servers.server_status(scope, id) do
      json(conn, %{status: ServerJSON.status(status)})
    end
  end

  defp parse_lines(nil), do: 100

  defp parse_lines(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} when n > 0 -> n
      _ -> 100
    end
  end

  # Test seam (mirrors :boot_autostart): empty in dev/prod, set by the
  # lifecycle ConnCase test to drive the fake java harness + FakeRcon.
  defp start_opts, do: Application.get_env(:allay, :lifecycle_start_opts, [])

  defp fetch_server(scope, id) do
    case Servers.get_server(scope, id) do
      {:ok, server} -> {:ok, server}
      {:error, :not_found} -> {:error, :server_not_found}
    end
  end
end
