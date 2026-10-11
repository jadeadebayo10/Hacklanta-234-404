"""Plain-language explanation of the notice, ready to send to /speak.

Fixed templates (no AI): the words a stressed tenant hears should be
reviewed by a person, not generated fresh each time.
  - en, es: Atlanta
  - en, pcm (Nigerian Pidgin): Lagos
Pidgin and Spanish text MUST be reviewed by a native speaker before the demo.
"""

from __future__ import annotations


def _money(amount, currency):
    if amount is None:
        return None
    sym = "$" if currency == "USD" else "N"
    return f"{sym}{amount:,.0f}"


def explain(fields: dict, check: dict, lang: str = "en") -> dict:
    j = fields.get("jurisdiction") or "atlanta"
    build = _lagos if j == "lagos" else _atlanta
    result = build(fields, check, lang)          # full text, shown on screen
    private = {**fields, "landlord_name": None, "court": None, "amount_claimed": None}
    result["spoken"] = build(private, check, lang)["text"]   # scrubbed, sent to voice
    return result


def _atlanta(fields, check, lang):
    d = check.get("deadline") or {}
    due = d.get("deadline_label", "the date on your paper")
    left = d.get("days_left")
    amount = _money(fields.get("amount_claimed"), "USD")
    es = lang == "es"
    landlord = fields.get("landlord_name") or ("su propietario" if es else "your landlord")
    court = fields.get("court") or ("la corte de magistrados" if es else "the magistrate court")

    if lang == "es":
        parts = [
            f"Este papel es una demanda de desalojo de {landlord} en {court}.",
            f"Usted tiene hasta el {due}, a las 5 de la tarde, para presentar una respuesta.",
        ]
        if left is not None and left >= 0:
            parts.append(f"Le quedan {left} días.")
        if amount:
            parts.append(f"Dicen que usted debe {amount}.")
        parts += [
            "Si no responde a tiempo, el propietario puede pedirle a la corte que lo saquen sin una audiencia.",
            "Si responde, la corte le dará una fecha de audiencia.",
            "Esto no es asesoría legal. Puede pedir ayuda gratis a Atlanta Legal Aid.",
        ]
    else:
        lang = "en"
        parts = [
            f"This paper is an eviction case filed by {landlord} in {court}.",
            f"You have until {due}, at 5 PM, to file an answer.",
        ]
        if left is not None and left >= 0:
            parts.append(f"That's {left} days from today.")
        if amount:
            parts.append(f"They say you owe {amount}.")
        parts += [
            "If you don't answer in time, your landlord can ask the court to remove you without a hearing.",
            "If you do answer, the court gives you a hearing date.",
            "This is not legal advice. You can get free help from Atlanta Legal Aid.",
        ]
    return {"lang": lang, "text": " ".join(parts)}


def _lagos(fields, check, lang):
    nc = check.get("notice_check") or {}
    given = nc.get("given_days")
    required = nc.get("required_days")
    landlord = fields.get("landlord_name") or "your landlord"

    if lang == "pcm":
        parts = [f"Dis paper na quit notice from {landlord}."]
        if given is not None:
            parts.append(f"E give you {given} days make you comot.")
        if nc.get("ok") is False and required:
            parts.append(f"For how you dey pay rent, the law fit want make dem give you at least {required} days. Dis one fit too short.")
        parts += [
            "Landlord no fit force you comot, change your lock, or carry your things without court order.",
            "Keep every paper wey dem give you.",
            "Dis one no be legal advice. Find lawyer or legal aid make dem check am.",
        ]
    else:
        lang = "en"
        parts = [f"This paper is a notice to quit from {landlord}."]
        if given is not None:
            parts.append(f"It gives you {given} days to leave.")
        if nc.get("ok") is False and required:
            parts.append(f"For your rent period, the law may require at least {required} days. This notice may be too short.")
        parts += [
            "A landlord should not force you out, change your locks, or remove your things without a court order.",
            "Keep every notice you receive.",
            "This is not legal advice. Ask a lawyer or legal aid to check it.",
        ]
    return {"lang": lang, "text": " ".join(parts)}
