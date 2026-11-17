// Prologue: the sick cattle. Touching the cow is kindness and evidence at once.
// Clue: a bundle of red thread and hair under the manger, bound the way Stana binds.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL get_stat(id)
EXTERNAL add_stat(id, value)
EXTERNAL record_decision(id, choice)

{get_stat("nights-survived") < 1: -> quiet}
{get_flag("prologue-byre-visited"): -> after}
The byre stinks of sickness. Three cows lie down and will not stand. Flies walk on their eyes.
Old Petar the cowherd does not greet you. He watches your hands.
~ set_flag("prologue-byre-visited")
* [Lay your hands on the worst of them. #empathy #virtue:compassion]
    The cow is burning. Under your palm its heart stumbles, once, twice — and stops.
    Petar crosses himself. He does not say anything. He will say it later. #shake
    ~ set_flag("prologue-cattle-touched")
    ~ record_decision("prologue-cow", "touched")
    -> manger
* [Keep your distance. Look at the fodder instead. #occult]
    ~ record_decision("prologue-cow", "looked")
    -> manger

= manger
Under the manger, in the dust, something small: a knot of red thread wound around grey hair.
Bound three times at the waist. The way your mother taught you. The way only you do it in Mrak.
~ add_stat("sanity", -5)
-> END

= after
Petar has nailed a horseshoe over the byre door, points down. To keep something in, or out.
-> leave

= quiet
The cattle doze in the heat. Nothing is wrong here. Not yet.
-> leave

= leave
* [Leave.]
    -> END
