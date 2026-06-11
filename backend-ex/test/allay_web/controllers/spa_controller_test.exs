defmodule AllayWeb.SPAControllerTest do
  use AllayWeb.ConnCase, async: false

  @index_path Path.join(Application.app_dir(:allay, "priv/static"), "index.html")

  setup do
    File.mkdir_p!(Path.dirname(@index_path))
    File.write!(@index_path, "<html>allay spa</html>")
    on_exit(fn -> File.rm(@index_path) end)
    :ok
  end

  test "unmatched route serves the SPA index", %{conn: conn} do
    conn = get(conn, "/servers/some-uuid")
    assert html_response(conn, 200) =~ "allay spa"
  end

  test "unmatched /api route stays a JSON 404", %{conn: conn} do
    conn = get(conn, "/api/does-not-exist")
    assert %{"code" => "NOT_FOUND"} = json_response(conn, 404)
  end
end
