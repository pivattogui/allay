defmodule AllayWeb.AuthControllerTest do
  use AllayWeb.ConnCase, async: true

  import Allay.AccountsFixtures

  alias Allay.Accounts

  describe "GET /api/auth/status" do
    test "reports setup required on empty database", %{conn: conn} do
      assert json_response(get(conn, ~p"/api/auth/status"), 200) == %{"setupRequired" => true}
    end

    test "reports setup done once the admin exists", %{conn: conn} do
      user_fixture()
      assert json_response(get(conn, ~p"/api/auth/status"), 200) == %{"setupRequired" => false}
    end
  end

  describe "POST /api/auth/setup" do
    test "creates the initial admin", %{conn: conn} do
      conn =
        post(conn, ~p"/api/auth/setup", %{"username" => "admin", "password" => "supersecret123"})

      assert json_response(conn, 200) == %{"message" => "Setup completed successfully"}
      refute Accounts.setup_required?()
    end

    test "409 when already set up", %{conn: conn} do
      user_fixture()

      conn =
        post(conn, ~p"/api/auth/setup", %{"username" => "other", "password" => "supersecret123"})

      assert %{"code" => "SETUP_COMPLETED"} = json_response(conn, 409)
    end

    test "400 with field details on invalid payload", %{conn: conn} do
      conn = post(conn, ~p"/api/auth/setup", %{"username" => "ab", "password" => "short"})
      assert %{"code" => "VALIDATION_ERROR", "details" => details} = json_response(conn, 400)
      assert Map.has_key?(details, "password")
    end
  end

  describe "POST /api/auth/login" do
    setup do
      %{user: user_fixture()}
    end

    test "returns a working token and the user", %{conn: conn, user: user} do
      conn =
        post(conn, ~p"/api/auth/login", %{
          "username" => user.username,
          "password" => valid_password()
        })

      assert %{"token" => token, "user" => %{"id" => id, "username" => username}} =
               json_response(conn, 200)

      assert id == user.id
      assert username == user.username
      assert {:ok, _user} = Accounts.fetch_user_by_api_token(token)
    end

    test "401 on wrong password", %{conn: conn, user: user} do
      conn =
        post(conn, ~p"/api/auth/login", %{"username" => user.username, "password" => "wrong-pass"})

      assert %{"code" => "INVALID_CREDENTIALS"} = json_response(conn, 401)
    end

    test "400 on missing fields", %{conn: conn} do
      conn = post(conn, ~p"/api/auth/login", %{"username" => "admin"})
      assert %{"code" => "VALIDATION_ERROR"} = json_response(conn, 400)
    end
  end

  describe "GET /api/auth/me" do
    setup do
      user = user_fixture()
      %{user: user, token: Accounts.create_user_api_token(user)}
    end

    test "returns the current user", %{conn: conn, user: user, token: token} do
      conn =
        conn
        |> put_req_header("authorization", "Bearer #{token}")
        |> get(~p"/api/auth/me")

      assert %{"user" => %{"id" => id, "username" => _, "createdAt" => _}} =
               json_response(conn, 200)

      assert id == user.id
    end

    test "401 without token", %{conn: conn} do
      assert %{"code" => "UNAUTHORIZED"} = json_response(get(conn, ~p"/api/auth/me"), 401)
    end

    test "401 with invalid token", %{conn: conn} do
      conn =
        conn
        |> put_req_header("authorization", "Bearer garbage")
        |> get(~p"/api/auth/me")

      assert %{"code" => "UNAUTHORIZED"} = json_response(conn, 401)
    end
  end
end
