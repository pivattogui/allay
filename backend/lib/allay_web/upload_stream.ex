defmodule AllayWeb.UploadStream do
  @moduledoc false

  import Plug.Conn, only: [get_req_header: 2, read_body: 2]

  @chunk_bytes 1_048_576

  def write(conn, path, opts \\ []) do
    max_bytes = Keyword.get(opts, :max_bytes, max_upload_bytes())
    read_body_fun = Keyword.get(opts, :read_body_fun, &read_body/2)

    with :ok <- validate_content_length(conn, max_bytes),
         {:ok, file} <- File.open(path, [:write, :binary, :exclusive]) do
      write_to_file(conn, file, path, max_bytes, read_body_fun)
    else
      {:error, :eexist} -> {:error, :upload_error}
      {:error, reason} -> {:error, reason}
    end
  end

  defp validate_content_length(conn, max_bytes) do
    case get_req_header(conn, "content-length") do
      [value] -> validate_content_length_value(value, max_bytes)
      _ -> :ok
    end
  end

  defp validate_content_length_value(value, max_bytes) do
    case Integer.parse(value) do
      {length, ""} when length >= 0 and length <= max_bytes -> :ok
      {length, ""} when length > max_bytes -> {:error, :upload_too_large}
      _ -> {:error, :upload_error}
    end
  end

  defp write_to_file(conn, file, path, max_bytes, read_body_fun) do
    result =
      try do
        write_chunks(conn, file, 0, max_bytes, read_body_fun)
      rescue
        error -> {:error, {:upload_failed, Exception.message(error)}}
      after
        File.close(file)
      end

    case result do
      {:ok, _conn, _size} = success ->
        success

      {:error, reason} ->
        File.rm(path)
        {:error, reason}
    end
  end

  defp write_chunks(conn, file, size, max_bytes, read_body_fun) do
    case read_body_fun.(conn, length: @chunk_bytes, read_length: @chunk_bytes) do
      {:ok, chunk, conn} ->
        write_chunk(file, conn, chunk, size, max_bytes, read_body_fun, true)

      {:more, chunk, conn} ->
        write_chunk(file, conn, chunk, size, max_bytes, read_body_fun, false)

      {:error, reason} ->
        {:error, {:upload_failed, reason}}
    end
  end

  defp write_chunk(file, conn, chunk, size, max_bytes, read_body_fun, finished?) do
    next_size = size + byte_size(chunk)

    if next_size > max_bytes do
      {:error, :upload_too_large}
    else
      IO.binwrite(file, chunk)
      continue_upload(file, conn, next_size, max_bytes, read_body_fun, finished?)
    end
  end

  defp continue_upload(_file, conn, size, _max_bytes, _read_body_fun, true) do
    {:ok, conn, size}
  end

  defp continue_upload(file, conn, size, max_bytes, read_body_fun, false) do
    write_chunks(conn, file, size, max_bytes, read_body_fun)
  end

  defp max_upload_bytes do
    Application.fetch_env!(:allay, :max_upload_bytes)
  end
end
