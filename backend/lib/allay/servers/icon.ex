defmodule Allay.Servers.Icon do
  @moduledoc false

  alias Allay.Accounts.Scope
  alias Allay.Servers
  alias Allay.Servers.OperationLock

  @icon_filename "server-icon.png"

  def store(%Scope{} = scope, server_id, image_bytes) do
    OperationLock.run(server_id, :file_write, fn ->
      with {:ok, server} <- Servers.get_server(scope, server_id),
           {:ok, icon_path} <- process_icon(server.directory, image_bytes),
           :ok <- Servers.set_icon_path(scope, server_id, @icon_filename) do
        {:ok, icon_path}
      end
    end)
  end

  def delete(%Scope{} = scope, server_id) do
    OperationLock.run(server_id, :file_write, fn ->
      with {:ok, server} <- Servers.get_server(scope, server_id) do
        File.rm(icon_path(server.directory))
        Servers.set_icon_path(scope, server_id, nil)
      end
    end)
  end

  defp process_icon(directory, image_bytes) do
    path = icon_path(directory)

    try do
      {:ok, image} = Image.from_binary(image_bytes)

      image
      |> Image.thumbnail!("64x64", crop: :center)
      |> Image.write!(path)

      {:ok, path}
    rescue
      _error -> {:error, :image_processing_failed}
    end
  end

  defp icon_path(directory), do: Path.join(directory, @icon_filename)
end
