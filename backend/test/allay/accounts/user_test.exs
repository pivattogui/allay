defmodule Allay.Accounts.UserTest do
  use Allay.DataCase, async: true

  alias Allay.Accounts.User

  @valid_attrs %{"username" => "admin", "password" => "supersecret123"}

  describe "registration_changeset/2" do
    test "valid attrs produce a valid changeset with hashed password" do
      changeset = User.registration_changeset(%User{}, @valid_attrs)

      assert changeset.valid?
      assert get_change(changeset, :hashed_password)
      refute get_change(changeset, :password)
    end

    test "rejects short username, short password, bad characters" do
      for attrs <- [
            %{@valid_attrs | "username" => "ab"},
            %{@valid_attrs | "password" => "short"},
            %{@valid_attrs | "username" => "has spaces!"}
          ] do
        refute User.registration_changeset(%User{}, attrs).valid?
      end
    end
  end

  describe "valid_password?/2" do
    test "verifies the hashed password and rejects wrong ones" do
      user =
        %User{}
        |> User.registration_changeset(@valid_attrs)
        |> Ecto.Changeset.apply_changes()

      assert User.valid_password?(user, "supersecret123")
      refute User.valid_password?(user, "wrong-password")
      refute User.valid_password?(nil, "supersecret123")
    end
  end
end
