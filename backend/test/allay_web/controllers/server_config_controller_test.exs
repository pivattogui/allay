defmodule AllayWeb.ServerConfigControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures
  import Allay.ServersFixtures

  alias Allay.Accounts

  @config_keys ~w(
    id name type version port ramMinMb ramMaxMb jvmArgs javaPath
    autoStart autoRestart restartLimit restartSchedule iconPath
  )

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)
    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}")}
  end

  describe "auth" do
    test "401 without token", %{conn: conn} do
      server = server_fixture()
      conn = delete_req_header(conn, "authorization")
      assert json_response(get(conn, ~p"/api/servers/#{server.id}/config"), 401)
    end
  end

  describe "GET /api/servers/:id/config" do
    test "200 with the 14-field projection", %{conn: conn} do
      server = server_fixture()

      assert %{"config" => config} =
               json_response(get(conn, ~p"/api/servers/#{server.id}/config"), 200)

      assert MapSet.new(Map.keys(config)) == MapSet.new(@config_keys)
      assert config["id"] == server.id
    end

    test "404 for unknown id", %{conn: conn} do
      assert %{"code" => "SERVER_NOT_FOUND"} =
               json_response(get(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/config"), 404)
    end
  end

  describe "PATCH /api/servers/:id/config" do
    test "200 returns config and needsRestart false when stopped", %{conn: conn} do
      server = server_fixture()

      conn = patch(conn, ~p"/api/servers/#{server.id}/config", %{"jvmArgs" => "-XX:+UseZGC"})
      assert %{"config" => config, "needsRestart" => false} = json_response(conn, 200)
      assert config["jvmArgs"] == "-XX:+UseZGC"
      assert MapSet.new(Map.keys(config)) == MapSet.new(@config_keys)
    end

    test "400 VALIDATION_ERROR on bad restartLimit", %{conn: conn} do
      server = server_fixture()
      conn = patch(conn, ~p"/api/servers/#{server.id}/config", %{"restartLimit" => 99})
      assert %{"code" => "VALIDATION_ERROR"} = json_response(conn, 400)
    end

    test "404 for unknown id", %{conn: conn} do
      conn = patch(conn, ~p"/api/servers/#{Ecto.UUID.generate()}/config", %{"name" => "x"})
      assert %{"code" => "SERVER_NOT_FOUND"} = json_response(conn, 404)
    end
  end
end
