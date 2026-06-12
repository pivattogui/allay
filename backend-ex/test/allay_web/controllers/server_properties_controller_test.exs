defmodule AllayWeb.ServerPropertiesControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)
    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}")}
  end

  defp server_with_dir(content, attrs \\ %{}) do
    dir = Path.join(System.tmp_dir!(), "propctl-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    if content, do: File.write!(Path.join(dir, "server.properties"), content)
    on_exit(fn -> File.rm_rf!(dir) end)
    {server_fixture(Map.put(attrs, :directory, dir)), dir}
  end

  describe "auth" do
    test "401 without token", %{conn: conn} do
      {server, _dir} = server_with_dir("server-port=25565\n")
      conn = delete_req_header(conn, "authorization")
      assert json_response(get(conn, ~p"/api/servers/#{server.id}/properties"), 401)
    end
  end

  describe "GET /api/servers/:id/properties" do
    test "200 with parsed properties map", %{conn: conn} do
      {server, _dir} = server_with_dir("server-port=25565\nmotd=hi\n")

      assert %{"properties" => %{"server-port" => "25565", "motd" => "hi"}} =
               json_response(get(conn, ~p"/api/servers/#{server.id}/properties"), 200)
    end

    test "200 with empty map when file missing", %{conn: conn} do
      {server, _dir} = server_with_dir(nil)

      assert %{"properties" => %{}} =
               json_response(get(conn, ~p"/api/servers/#{server.id}/properties"), 200)
    end

    test "404 SERVER_NOT_FOUND for unknown id", %{conn: conn} do
      assert %{"code" => "SERVER_NOT_FOUND"} =
               json_response(get(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/properties"), 404)
    end
  end

  describe "PUT /api/servers/:id/properties" do
    test "200 writes the map and reports needsRestart/portConflict", %{conn: conn} do
      {server, dir} = server_with_dir("server-port=25565\n", %{port: 25_565, rcon_port: 35_565})

      conn =
        put(conn, ~p"/api/servers/#{server.id}/properties", %{
          "properties" => %{"motd" => "new"}
        })

      assert %{"needsRestart" => false, "portConflict" => false} = json_response(conn, 200)
      assert File.read!(Path.join(dir, "server.properties")) =~ "motd=new"
    end

    test "portConflict true when the requested port is taken", %{conn: conn} do
      _holder = server_fixture(%{port: 25_570, rcon_port: 35_570})
      {server, _dir} = server_with_dir("server-port=25565\n", %{port: 25_565, rcon_port: 35_565})

      conn =
        put(conn, ~p"/api/servers/#{server.id}/properties", %{
          "properties" => %{"server-port" => "25570"}
        })

      assert %{"portConflict" => true} = json_response(conn, 200)
    end

    test "404 for unknown id", %{conn: conn} do
      conn =
        put(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/properties", %{
          "properties" => %{"a" => "b"}
        })

      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end

  describe "GET /api/servers/:id/properties/raw" do
    test "200 with verbatim content", %{conn: conn} do
      {server, _dir} = server_with_dir("# comment\nserver-port=25565\n")

      assert %{"content" => "# comment\nserver-port=25565\n"} =
               json_response(get(conn, ~p"/api/servers/#{server.id}/properties/raw"), 200)
    end

    test "404 PROPERTIES_NOT_FOUND when file missing", %{conn: conn} do
      {server, _dir} = server_with_dir(nil)

      assert %{"code" => "PROPERTIES_NOT_FOUND"} =
               json_response(get(conn, ~p"/api/servers/#{server.id}/properties/raw"), 404)
    end

    test "404 SERVER_NOT_FOUND for unknown id", %{conn: conn} do
      assert %{"code" => "SERVER_NOT_FOUND"} =
               json_response(
                 get(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/properties/raw"),
                 404
               )
    end
  end

  describe "PUT /api/servers/:id/properties/raw" do
    test "200 writes verbatim and reports needsRestart", %{conn: conn} do
      {server, dir} = server_with_dir("server-port=25565\n", %{port: 25_565, rcon_port: 35_565})
      content = "# kept\nserver-port=25566\nmotd=hi\n"

      conn = put(conn, ~p"/api/servers/#{server.id}/properties/raw", %{"content" => content})

      assert %{"needsRestart" => false, "portConflict" => false} = json_response(conn, 200)
      assert File.read!(Path.join(dir, "server.properties")) == content
    end

    test "404 for unknown id", %{conn: conn} do
      conn =
        put(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/properties/raw", %{"content" => "x"})

      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end
end
