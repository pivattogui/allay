defmodule AllayWeb.StaticServingTest do
  use AllayWeb.ConnCase, async: false

  @assets_dir Path.join(Application.app_dir(:allay, "priv/static"), "assets")

  test "Plug.Static serves a hashed asset under /assets", %{conn: conn} do
    name = "test-#{System.unique_integer([:positive])}.js"
    path = Path.join(@assets_dir, name)
    body = "console.log('allay');"

    File.mkdir_p!(@assets_dir)
    File.write!(path, body)
    on_exit(fn -> File.rm(path) end)

    conn = get(conn, "/assets/#{name}")

    assert response(conn, 200) == body
  end
end
