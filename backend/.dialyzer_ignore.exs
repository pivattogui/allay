# False positive from Phoenix's router macro expansion — not our code.
# https://github.com/jeremyjh/dialyxir/issues/558
[
  {"deps/phoenix/lib/phoenix/router.ex", :pattern_match}
]
