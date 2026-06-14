defmodule AllayWeb.HealthControllerTest do
  use AllayWeb.ConnCase, async: true

  test "GET /health returns ok with timestamp", %{conn: conn} do
    conn = get(conn, ~p"/health")
    assert %{"status" => "ok", "timestamp" => timestamp} = json_response(conn, 200)
    assert {:ok, _datetime, 0} = DateTime.from_iso8601(timestamp)
  end
end
