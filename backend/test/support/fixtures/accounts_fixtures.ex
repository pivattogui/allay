defmodule Allay.AccountsFixtures do
  alias Allay.Accounts

  def valid_password, do: "supersecret123"

  def user_fixture(attrs \\ %{}) do
    {:ok, user} =
      attrs
      |> Enum.into(%{"username" => "admin", "password" => valid_password()})
      |> Accounts.register_initial_admin()

    user
  end
end
