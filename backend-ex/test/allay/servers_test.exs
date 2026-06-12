defmodule Allay.ServersTest do
  use Allay.DataCase, async: false

  import Allay.ServersFixtures
  import Allay.AccountsFixtures

  alias Allay.Accounts
  alias Allay.Servers

  defp scope do
    user = user_fixture()
    Accounts.Scope.for_user(user)
  end

  describe "list_servers/1" do
    test "returns empty list when no servers" do
      assert [] = Servers.list_servers(scope())
    end

    test "returns all servers and orders newest first" do
      s1 = server_fixture()
      s2 = server_fixture(%{port: 25_566, rcon_port: 35_566})

      # Force distinct inserted_at values (utc_datetime truncates to seconds)
      past = DateTime.utc_now() |> DateTime.add(-60, :second) |> DateTime.truncate(:second)

      Repo.update_all(Allay.Servers.Server |> where([s], s.id == ^s1.id),
        set: [inserted_at: past]
      )

      result = Servers.list_servers(scope())
      ids = Enum.map(result, & &1.id)

      assert [s2.id, s1.id] == ids
    end

    test "scope is required as first arg (compile-level: just call it)" do
      sc = scope()
      assert is_list(Servers.list_servers(sc))
    end
  end

  describe "get_server/2" do
    test "returns {:ok, server} for existing id" do
      s = server_fixture()
      assert {:ok, fetched} = Servers.get_server(scope(), s.id)
      assert fetched.id == s.id
    end

    test "returns {:error, :not_found} for unknown uuid" do
      assert {:error, :not_found} = Servers.get_server(scope(), Ecto.UUID.generate())
    end

    test "returns {:error, :not_found} for invalid uuid string" do
      assert {:error, :not_found} = Servers.get_server(scope(), "not-a-uuid")
    end

    test "returns {:error, :not_found} for empty string" do
      assert {:error, :not_found} = Servers.get_server(scope(), "")
    end
  end
end
