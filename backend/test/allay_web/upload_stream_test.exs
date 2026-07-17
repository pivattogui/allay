defmodule AllayWeb.UploadStreamTest do
  use ExUnit.Case, async: true

  import Plug.Conn
  import Plug.Test

  alias AllayWeb.UploadStream

  setup do
    path = Path.join(System.tmp_dir!(), "upload-stream-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm(path) end)
    {:ok, path: path}
  end

  test "counts the body when content-length is absent", %{path: path} do
    conn = conn(:put, "/", "12345") |> delete_req_header("content-length")

    assert {:error, :upload_too_large} = UploadStream.write(conn, path, max_bytes: 4)
    refute File.exists?(path)
  end

  test "counts the body when content-length understates its size", %{path: path} do
    conn = conn(:put, "/", "12345") |> put_req_header("content-length", "1")

    assert {:error, :upload_too_large} = UploadStream.write(conn, path, max_bytes: 4)
    refute File.exists?(path)
  end

  test "rejects an oversized content-length before creating a file", %{path: path} do
    conn = conn(:put, "/", "x") |> put_req_header("content-length", "5")

    assert {:error, :upload_too_large} = UploadStream.write(conn, path, max_bytes: 4)
    refute File.exists?(path)
  end

  test "removes the partial file when the client disconnects", %{path: path} do
    read_body_fun = fn conn, _opts ->
      if conn.private[:chunk_read] do
        {:error, :closed}
      else
        {:more, "partial", put_private(conn, :chunk_read, true)}
      end
    end

    assert {:error, {:upload_failed, :closed}} =
             UploadStream.write(conn(:put, "/", ""), path,
               max_bytes: 100,
               read_body_fun: read_body_fun
             )

    refute File.exists?(path)
  end
end
