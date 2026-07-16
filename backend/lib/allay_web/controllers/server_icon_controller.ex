defmodule AllayWeb.ServerIconController do
  use AllayWeb, :controller

  alias Allay.Servers

  action_fallback AllayWeb.FallbackController

  @icon_filename "server-icon.png"
  @max_bytes 5 * 1024 * 1024

  def create(conn, %{"id" => id} = params) do
    scope = conn.assigns.current_scope

    with {:ok, server} <- fetch_server(scope, id),
         {:ok, upload} <- fetch_upload(params),
         :ok <- validate_image_type(upload),
         {:ok, bytes} <- read_within_limit(upload),
         {:ok, _path} <- process_icon(server, bytes),
         :ok <- Servers.set_icon_path(scope, id, @icon_filename) do
      json(conn, %{iconPath: @icon_filename})
    end
  end

  def show(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, server} <- fetch_icon_server(scope, id),
         path = icon_path(server),
         true <- File.exists?(path) || {:error, :icon_not_found} do
      conn
      |> put_resp_header("content-type", "image/png")
      |> put_resp_header("cache-control", "public, max-age=3600")
      |> send_file(200, path)
    end
  end

  def delete(conn, %{"id" => id}) do
    scope = conn.assigns.current_scope

    with {:ok, server} <- fetch_server(scope, id) do
      File.rm(icon_path(server))

      case Servers.set_icon_path(scope, id, nil) do
        :ok -> json(conn, %{message: "Icon deleted successfully"})
        {:error, _} = error -> error
      end
    end
  end

  defp fetch_upload(%{"file" => %Plug.Upload{} = upload}), do: {:ok, upload}
  defp fetch_upload(_params), do: {:error, :no_file}

  defp validate_image_type(%Plug.Upload{content_type: "image/" <> _}), do: :ok
  defp validate_image_type(_upload), do: {:error, :invalid_file_type}

  defp read_within_limit(%Plug.Upload{path: path}) do
    case File.stat(path) do
      {:ok, %File.Stat{size: size}} when size > @max_bytes -> {:error, :file_too_large}
      {:ok, _} -> {:ok, File.read!(path)}
      {:error, _} -> {:error, :no_file}
    end
  end

  defp process_icon(server, bytes) do
    path = icon_path(server)

    try do
      {:ok, image} = Image.from_binary(bytes)

      image
      |> Image.thumbnail!("64x64", crop: :center)
      |> Image.write!(path)

      {:ok, path}
    rescue
      _ -> {:error, :image_processing_failed}
    end
  end

  defp icon_path(server), do: Path.join(server.directory, @icon_filename)

  defp fetch_server(scope, id) do
    case Servers.get_server(scope, id) do
      {:ok, server} -> {:ok, server}
      {:error, :not_found} -> {:error, :server_not_found}
    end
  end

  # GET /icon returns ICON_NOT_FOUND even when the server row is missing
  # (legacy parity: the icon endpoint never distinguishes the two).
  defp fetch_icon_server(scope, id) do
    case Servers.get_server(scope, id) do
      {:ok, server} -> {:ok, server}
      {:error, :not_found} -> {:error, :icon_not_found}
    end
  end
end
