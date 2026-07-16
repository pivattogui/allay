defmodule Allay.AccountsTest do
  use Allay.DataCase, async: true

  import Allay.AccountsFixtures

  alias Allay.Accounts
  alias Allay.Accounts.UserToken

  describe "setup_required?/0" do
    test "true with no users, false after registration" do
      assert Accounts.setup_required?()
      user_fixture()
      refute Accounts.setup_required?()
    end
  end

  describe "register_initial_admin/1" do
    test "creates the admin and never persists the plain password" do
      {:ok, user} =
        Accounts.register_initial_admin(%{"username" => "admin", "password" => valid_password()})

      assert user.username == "admin"
      assert user.hashed_password != valid_password()
      assert is_nil(user.password)
    end

    test "refuses a second admin" do
      user_fixture()

      assert {:error, :already_setup} =
               Accounts.register_initial_admin(%{
                 "username" => "other",
                 "password" => valid_password()
               })
    end

    test "returns changeset errors for invalid attrs" do
      assert {:error, %Ecto.Changeset{} = changeset} =
               Accounts.register_initial_admin(%{"username" => "ab", "password" => "short"})

      assert %{username: _, password: _} = errors_on(changeset)
    end
  end

  describe "authenticate_user/2" do
    test "returns the user for valid credentials" do
      user = user_fixture()
      assert {:ok, authenticated} = Accounts.authenticate_user(user.username, valid_password())
      assert authenticated.id == user.id
    end

    test "rejects wrong password and unknown username identically" do
      user = user_fixture()

      assert {:error, :invalid_credentials} =
               Accounts.authenticate_user(user.username, "nope-nope")

      assert {:error, :invalid_credentials} =
               Accounts.authenticate_user("ghost", valid_password())
    end
  end

  describe "create_user_api_token/1 and fetch_user_by_api_token/1" do
    test "round-trips a valid token" do
      user = user_fixture()
      token = Accounts.create_user_api_token(user)
      assert {:ok, fetched} = Accounts.fetch_user_by_api_token(token)
      assert fetched.id == user.id
    end

    test "rejects garbage and undecodable tokens" do
      assert :error = Accounts.fetch_user_by_api_token("garbage")
      assert :error = Accounts.fetch_user_by_api_token("!!!not-base64!!!")
    end

    test "rejects expired tokens" do
      user = user_fixture()
      token = Accounts.create_user_api_token(user)

      expired_at =
        DateTime.utc_now() |> DateTime.add(-31, :day) |> DateTime.truncate(:second)

      {1, nil} = Repo.update_all(UserToken, set: [inserted_at: expired_at])

      assert :error = Accounts.fetch_user_by_api_token(token)
    end
  end
end
