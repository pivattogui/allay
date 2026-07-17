defmodule AllayWeb.Plugs.CorsTest do
  use ExUnit.Case, async: false

  import Plug.Conn
  import Plug.Test

  alias AllayWeb.Plugs.Cors

  setup do
    previous_origins = Application.get_env(:allay, :cors_allowed_origins)
    Application.put_env(:allay, :cors_allowed_origins, ["http://localhost:5173"])

    on_exit(fn ->
      if previous_origins do
        Application.put_env(:allay, :cors_allowed_origins, previous_origins)
      else
        Application.delete_env(:allay, :cors_allowed_origins)
      end
    end)
  end

  test "adds CORS headers for an allowed origin" do
    conn =
      conn(:get, "/api/auth/status")
      |> put_req_header("origin", "http://localhost:5173")
      |> Cors.call([])

    assert get_resp_header(conn, "access-control-allow-origin") == ["http://localhost:5173"]
    assert get_resp_header(conn, "vary") == ["origin"]
  end

  test "does not add CORS headers for another origin" do
    conn =
      conn(:get, "/api/auth/status")
      |> put_req_header("origin", "https://untrusted.example")
      |> Cors.call([])

    assert get_resp_header(conn, "access-control-allow-origin") == []
  end

  test "answers an allowed preflight request" do
    conn =
      conn(:options, "/api/servers")
      |> put_req_header("origin", "http://localhost:5173")
      |> Cors.call([])

    assert conn.halted
    assert conn.status == 204

    assert get_resp_header(conn, "access-control-allow-methods") == [
             "GET, POST, PUT, PATCH, DELETE, OPTIONS"
           ]

    assert get_resp_header(conn, "access-control-allow-headers") == [
             "authorization, content-type, x-filename"
           ]
  end
end
