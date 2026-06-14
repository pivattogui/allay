defmodule Allay.Backups.Backup do
  @moduledoc """
  A single backup archive row. `type` is one of "manual" | "scheduled" |
  "pre-import"; `status` is "pending" | "completed" | "failed". The row is
  inserted "pending"/0 bytes BEFORE tar runs so the polling UI sees the
  in-flight archive (legacy parity). Carries `inserted_at` only — backups are
  immutable once stat'd (no `updated_at`).
  """

  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "backups" do
    belongs_to :server, Allay.Servers.Server

    field :filename, :string
    field :size_bytes, :integer, default: 0
    field :type, :string, default: "manual"
    field :status, :string, default: "completed"

    timestamps(type: :utc_datetime, updated_at: false)
  end
end
