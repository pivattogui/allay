defmodule Allay.Runtime.LogLine do
  @moduledoc false

  @paper_header ~r/^\[\d{2}:\d{2}:\d{2}\s+(?<level>\w+)\]:\s?/
  @vanilla_header ~r/^\[\d{2}:\d{2}:\d{2}\]\s\[[^\]]*\/(?<level>\w+)\]:\s?/

  def parse(raw, %DateTime{} = timestamp) when is_binary(raw) do
    {level, message} =
      case Regex.named_captures(@paper_header, raw) || Regex.named_captures(@vanilla_header, raw) do
        %{"level" => level} ->
          header = Regex.run(@paper_header, raw) || Regex.run(@vanilla_header, raw)
          {normalize_level(level), String.replace_prefix(raw, hd(header), "")}

        nil ->
          {:info, raw}
      end

    %{timestamp: timestamp, level: level, message: message}
  end

  def render(%{timestamp: timestamp, level: level, message: message}) do
    %{
      timestamp: DateTime.to_iso8601(timestamp),
      level: Atom.to_string(level),
      message: message
    }
  end

  defp normalize_level(level) do
    case String.downcase(level) do
      "warn" -> :warn
      "error" -> :error
      _ -> :info
    end
  end
end
