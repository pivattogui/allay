defmodule AllayWeb.SystemControllerTest do
  use AllayWeb.ConnCase, async: false

  import Allay.AccountsFixtures

  alias Allay.Accounts
  alias Allay.Servers.JavaRegistry

  @manifest %{
    "versions" => [
      %{"id" => "1.21.4", "type" => "release", "url" => "https://meta.example/1.json"},
      %{"id" => "1.21.3", "type" => "release", "url" => "https://meta.example/2.json"}
    ]
  }

  setup %{conn: conn} do
    user = user_fixture()
    token = Accounts.create_user_api_token(user)
    {:ok, conn: put_req_header(conn, "authorization", "Bearer #{token}")}
  end

  describe "auth" do
    test "401 without token", %{conn: conn} do
      conn = delete_req_header(conn, "authorization")
      assert json_response(get(conn, ~p"/api/system/server-types"), 401)
    end
  end

  describe "GET /api/system/server-types" do
    test "200 with vanilla and paper", %{conn: conn} do
      assert %{"types" => types} = json_response(get(conn, ~p"/api/system/server-types"), 200)

      assert types == [
               %{"id" => "vanilla", "name" => "Vanilla"},
               %{"id" => "paper", "name" => "Paper"}
             ]
    end
  end

  describe "GET /api/system/versions/:type" do
    test "200 with version list for vanilla", %{conn: conn} do
      Req.Test.stub(Allay.Minecraft.APIStub, fn c ->
        Req.Test.json(c, @manifest)
      end)

      assert %{"versions" => ["1.21.4", "1.21.3"]} =
               json_response(get(conn, ~p"/api/system/versions/vanilla"), 200)
    end

    test "400 VALIDATION_ERROR for invalid type", %{conn: conn} do
      assert %{"code" => "VALIDATION_ERROR"} =
               json_response(get(conn, ~p"/api/system/versions/bogus"), 400)
    end

    test "500 FETCH_VERSIONS_FAILED on upstream error", %{conn: conn} do
      Req.Test.stub(Allay.Minecraft.APIStub, fn c ->
        Plug.Conn.send_resp(c, 500, "boom")
      end)

      assert %{"code" => "FETCH_VERSIONS_FAILED"} =
               json_response(get(conn, ~p"/api/system/versions/vanilla"), 500)
    end
  end

  describe "GET /api/system/info" do
    test "200 with portRange and system fields", %{conn: conn} do
      JavaRegistry.put(%{21 => "/usr/bin/java"})

      assert %{
               "portRange" => %{"min" => min, "max" => max},
               "cpuCount" => cpu,
               "platform" => _,
               "arch" => _,
               "totalRamMb" => _,
               "javaMajors" => majors
             } = json_response(get(conn, ~p"/api/system/info"), 200)

      assert is_integer(min) and is_integer(max)
      assert cpu == System.schedulers_online()
      assert 21 in majors
    end
  end
end
