defmodule Allay.Minecraft.Properties do
  @moduledoc """
  server.properties as data. `parse/1` and `serialize/1` mirror the
  legacy key-value endpoints (comments are not preserved — the raw-file
  endpoint is the preservation path); `put_key/3` edits one key in raw
  text, preserving comments and ordering, appending when absent.
  """

  def parse(raw) when is_binary(raw) do
    raw
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == "" or String.starts_with?(&1, "#")))
    |> Enum.reduce(%{}, fn line, acc ->
      case String.split(line, "=", parts: 2) do
        [key, value] when key != "" -> Map.put(acc, key, value)
        _ -> acc
      end
    end)
  end

  def serialize(props) when is_map(props) do
    props
    |> Enum.map_join("\n", fn {key, value} -> "#{key}=#{value}" end)
    |> Kernel.<>("\n")
  end

  def put_key(raw, key, value) when is_binary(raw) do
    line = "#{key}=#{value}"
    pattern = ~r/^#{Regex.escape(key)}=.*$/m

    cond do
      Regex.match?(pattern, raw) -> Regex.replace(pattern, raw, fn _ -> line end)
      raw == "" -> line <> "\n"
      String.ends_with?(raw, "\n") -> raw <> line <> "\n"
      true -> raw <> "\n" <> line <> "\n"
    end
  end
end
