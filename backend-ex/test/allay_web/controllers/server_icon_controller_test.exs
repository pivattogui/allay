defmodule AllayWeb.ServerIconControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts
  alias Allay.Repo
  alias Allay.Servers.Server

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)
    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}")}
  end

  defp server_with_dir do
    dir = Path.join(System.tmp_dir!(), "icon-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    {server_fixture(%{directory: dir}), dir}
  end

  defp png_bytes(width, height) do
    {:ok, image} = Image.new(width, height, color: [10, 20, 30])
    {:ok, binary} = Image.write(image, :memory, suffix: ".png")
    binary
  end

  defp upload(bytes, content_type, filename \\ "icon.png") do
    path = Path.join(System.tmp_dir!(), "upload-#{System.unique_integer([:positive])}.bin")
    File.write!(path, bytes)
    on_exit(fn -> File.rm_rf!(path) end)
    %Plug.Upload{path: path, content_type: content_type, filename: filename}
  end

  describe "auth" do
    test "401 without token", %{conn: conn} do
      {server, _dir} = server_with_dir()
      conn = delete_req_header(conn, "authorization")
      assert json_response(get(conn, ~p"/api/servers/#{server.id}/icon"), 401)
    end
  end

  describe "POST /api/servers/:id/icon" do
    test "200 processes a PNG to 64x64 and persists iconPath", %{conn: conn} do
      {server, dir} = server_with_dir()
      file = upload(png_bytes(120, 80), "image/png")

      conn = post(conn, ~p"/api/servers/#{server.id}/icon", %{"file" => file})
      assert json_response(conn, 200) == %{"iconPath" => "server-icon.png"}

      icon_path = Path.join(dir, "server-icon.png")
      assert File.exists?(icon_path)
      {:ok, written} = Image.open(icon_path)
      assert Image.width(written) == 64
      assert Image.height(written) == 64

      assert Repo.get!(Server, server.id).icon_path == "server-icon.png"
    end

    test "400 NO_FILE when field missing", %{conn: conn} do
      {server, _dir} = server_with_dir()
      conn = post(conn, ~p"/api/servers/#{server.id}/icon", %{})
      assert %{"code" => "NO_FILE"} = json_response(conn, 400)
    end

    test "400 INVALID_FILE_TYPE for non-image MIME", %{conn: conn} do
      {server, _dir} = server_with_dir()
      file = upload("not an image", "text/plain")
      conn = post(conn, ~p"/api/servers/#{server.id}/icon", %{"file" => file})
      assert %{"code" => "INVALID_FILE_TYPE"} = json_response(conn, 400)
    end

    test "400 FILE_TOO_LARGE over 5 MiB", %{conn: conn} do
      {server, _dir} = server_with_dir()
      big = :binary.copy(<<0>>, 5 * 1024 * 1024 + 1)
      file = upload(big, "image/png")
      conn = post(conn, ~p"/api/servers/#{server.id}/icon", %{"file" => file})
      assert %{"code" => "FILE_TOO_LARGE"} = json_response(conn, 400)
    end

    test "404 for unknown id", %{conn: conn} do
      file = upload(png_bytes(10, 10), "image/png")
      conn = post(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/icon", %{"file" => file})
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end

    test "500 IMAGE_PROCESSING_FAILED on undecodable image bytes", %{conn: conn} do
      {server, _dir} = server_with_dir()
      file = upload(<<0, 1, 2, 3, 4>>, "image/png")
      conn = post(conn, ~p"/api/servers/#{server.id}/icon", %{"file" => file})
      assert %{"code" => "IMAGE_PROCESSING_FAILED"} = json_response(conn, 500)
    end
  end

  describe "GET /api/servers/:id/icon" do
    test "200 image/png bytes with cache header", %{conn: conn} do
      {server, dir} = server_with_dir()
      File.write!(Path.join(dir, "server-icon.png"), png_bytes(64, 64))

      conn = get(conn, ~p"/api/servers/#{server.id}/icon")
      assert response(conn, 200)
      assert get_resp_header(conn, "content-type") == ["image/png"]
      assert get_resp_header(conn, "cache-control") == ["public, max-age=3600"]
    end

    test "404 ICON_NOT_FOUND when no icon on disk", %{conn: conn} do
      {server, _dir} = server_with_dir()
      conn = get(conn, ~p"/api/servers/#{server.id}/icon")
      assert %{"code" => "ICON_NOT_FOUND"} = json_response(conn, 404)
    end

    test "404 ICON_NOT_FOUND for unknown id", %{conn: conn} do
      conn = get(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/icon")
      assert %{"code" => "ICON_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  describe "DELETE /api/servers/:id/icon" do
    test "200 removes the file and clears iconPath", %{conn: conn} do
      {server, dir} = server_with_dir()
      File.write!(Path.join(dir, "server-icon.png"), png_bytes(64, 64))

      conn = delete(conn, ~p"/api/servers/#{server.id}/icon")
      assert json_response(conn, 200) == %{"message" => "Icon deleted successfully"}
      refute File.exists?(Path.join(dir, "server-icon.png"))
      assert Repo.get!(Server, server.id).icon_path == nil
    end

    test "404 for unknown id", %{conn: conn} do
      conn = delete(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/icon")
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end
end
