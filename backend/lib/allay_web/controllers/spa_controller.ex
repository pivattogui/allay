defmodule AllayWeb.SPAController do
  use AllayWeb, :controller

  def index(conn, %{"path" => ["api" | _rest]}) do
    conn
    |> put_status(:not_found)
    |> json(%{error: "Not found", code: "NOT_FOUND"})
  end

  def index(conn, _params) do
    index_path = Path.join(Application.app_dir(:allay, "priv/static"), "index.html")

    if File.exists?(index_path) do
      conn
      |> put_resp_content_type("text/html")
      |> put_resp_header("cache-control", "no-cache")
      |> send_file(200, index_path)
    else
      # Dev: the frontend runs on Vite (5173); there is no build to serve.
      send_resp(conn, 404, "Frontend build not present")
    end
  end
end
