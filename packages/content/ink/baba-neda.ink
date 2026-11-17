// Baba Neda — midwife and herb-woman. Afraid of fire and of being called a witch.
EXTERNAL get_flag(id)
EXTERNAL set_flag(id)
EXTERNAL has_item(id, qty)
EXTERNAL give_item(id, qty)
EXTERNAL skill_level(id)
EXTERNAL record_decision(id, choice)

{get_flag("neda-trusts-guardian"): "Come in, child. The kettle is on." | Neda does not open the door all the way. "What do you want at this hour?"}
* [Ask for herbs against the cold. #empathy]
    "Thyme and a little salt. And sleep, which I have none of."
    {has_item("st-johns-wort", 1): "You carry St John's wort already. Good. It knows the way." | "Pick St John's wort in summer, at dawn. Not before. Never after."}
    -> END
* [Ask what she knows about Stana. #occult #requires:skill:herbalism:1]
    Her hand stops on the pot. #shake
    "My grandmother was in the square in seventy-nine. She told me the smoke was green."
    "Do not say that name in the street, child. Walls listen in this village." #whisper
    ~ set_flag("neda-trusts-guardian")
    ~ record_decision("neda-stana", "asked")
    -> END
* [Tell her people are saying she charmed Velika. #threat]
    "Let them say. They said it of the last one, too, until they had their fire." #whisper
    ~ record_decision("neda-rumour", "told")
    -> END
* [Promise no one will touch her. #empathy #virtue:mercy]
    "You are young. Promises are cheap when you are young."
    She gives you a sprig of basil all the same, tied with red thread.
    ~ give_item("basil", 1)
    ~ set_flag("neda-trusts-guardian")
    -> END
