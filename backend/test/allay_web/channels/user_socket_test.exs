defmodule AllayWeb.UserSocketTest do
  use AllayWeb.ChannelCase, async: false

  import Allay.AccountsFixtures

  alias Allay.Accounts
  alias AllayWeb.UserSocket

  describe "connect/3" do
    test "accepts a valid api token and assigns the scope" do
      user = user_fixture()
      token = Accounts.create_user_api_token(user)

      assert {:ok, socket} = connect(UserSocket, %{"token" => token})
      assert socket.assigns.current_scope.user.id == user.id
    end

    test "rejects a garbage token" do
      assert :error = connect(UserSocket, %{"token" => "not-a-real-token"})
    end

    test "rejects a connection with no token param" do
      assert :error = connect(UserSocket, %{})
    end
  end

  describe "id/1" do
    test "namespaces by the scoped user id" do
      user = user_fixture()
      token = Accounts.create_user_api_token(user)

      assert {:ok, socket} = connect(UserSocket, %{"token" => token})
      assert UserSocket.id(socket) == "user_socket:#{user.id}"
    end
  end
end
