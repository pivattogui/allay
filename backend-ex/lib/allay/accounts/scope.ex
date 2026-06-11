defmodule Allay.Accounts.Scope do
  @moduledoc """
  Identity container passed as the first argument to public context
  functions (Phoenix 1.8 scopes convention). Single-admin today; the
  struct exists so authorization has one obvious place to grow.
  """

  alias Allay.Accounts.User

  defstruct user: nil

  def for_user(%User{} = user), do: %__MODULE__{user: user}
  def for_user(nil), do: nil
end
