defmodule AllayWeb.Plugs.Cors do
  @moduledoc false

  import Plug.Conn

  @allowed_methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  @allowed_headers "authorization, content-type, x-filename"

  def init(opts), do: opts

  def call(conn, _opts) do
    case allowed_origin(conn) do
      nil -> conn
      origin -> add_cors_headers(conn, origin)
    end
    |> handle_preflight()
  end

  defp allowed_origin(conn) do
    case get_req_header(conn, "origin") do
      [origin] ->
        allowed_origins = Application.get_env(:allay, :cors_allowed_origins, [])
        if origin in allowed_origins, do: origin

      _other ->
        nil
    end
  end

  defp add_cors_headers(conn, origin) do
    conn
    |> put_resp_header("access-control-allow-origin", origin)
    |> put_resp_header("access-control-allow-methods", @allowed_methods)
    |> put_resp_header("access-control-allow-headers", @allowed_headers)
    |> put_resp_header("vary", "origin")
  end

  defp handle_preflight(%Plug.Conn{method: "OPTIONS"} = conn) do
    conn
    |> send_resp(:no_content, "")
    |> halt()
  end

  defp handle_preflight(conn), do: conn
end
