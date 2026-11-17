// The one in the forest (docs/lore/villagers-mvp.md → Off-village NPCs). She speaks in fragments
// of folk song, in the second person. Narration never says what she is.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL add_stat(id, value)
EXTERNAL has_item(id, qty)
EXTERNAL record_decision(id, choice)

{get_flag("samodivi-allied"): -> kept}
{get_flag("forest-hostile"): -> closed}
~ set_flag("forest-spirit-heard")
The oak is very still. Something in its branches is singing, or the wind is. #sfx:wind-in-oak
"You came with salt in your pocket and fire in your lamp, guardian." #whisper
"Who walks the forest at night, the forest walks in him."
* [Ask who she is. #empathy]
    "A girl was burned in the square, and the ash was sown with millet."
    "Ask the old woman who sweeps the hut. Ask the bell." #whisper
    -> offer
* [Tell her the village fears this place. #threat]
    "Let them fear. Fear keeps the axe in the shed." #shake
    -> offer
* [Draw a circle of salt around yourself. #occult #requires:item:salt:1]
    The singing stops at the edge of the salt. Then it laughs, very softly.
    "Salt is for the dead, guardian. I am not so obliging."
    -> offer

= offer
"Leave the oaks standing. Let no iron into the grove. And I will keep the paths from your people."
* [Promise it. The grove stays. #empathy #virtue:loyalty]
    ~ set_flag("samodivi-allied")
    ~ record_decision("forest-oath", "promised")
    "Then the paths are yours, while you keep your word."
    The wind turns. Somewhere a cuckoo, out of season.
    -> END
* [Promise it, meaning none of it. #lie #sin:pride]
    ~ set_flag("samodivi-allied")
    ~ add_stat("corruption", 2)
    ~ record_decision("forest-oath", "lied")
    "Words are cheap at the crossroads. They are dear here." #whisper
    -> END
* [Say the grove will burn if a child is taken. #threat #sin:wrath]
    ~ set_flag("forest-hostile")
    ~ record_decision("forest-oath", "threatened")
    The oak creaks, though there is no wind. #shake
    "Then come with your fire, and see what the forest keeps."
    -> END
* [Say nothing yet, and go.]
    "The moon is long. I will be here." #whisper
    -> END

= kept
"You kept the oaks. The fern will open for you on Enyovden night." #whisper
-> END

= closed
The path to the oak is not where it was. You find it at last, and the tree is silent. #sfx:wind-in-oak
-> END
