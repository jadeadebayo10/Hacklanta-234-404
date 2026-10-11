"use client"; // runs on the phone: camera, audio and downloads

import { useEffect, useRef, useState } from "react";
import { STRINGS, LOCALE, voiceFor } from "@/lib/strings";
import { SAMPLE_FIELDS } from "@/lib/fake";
import { DEMO, wakeBackend, readNotice, checkNotice, explainNotice, speak, getDefenses, makeAnswer, makeSummary, getLegalAid, closedLabel } from "@/lib/api";
import { deadlineIcs, saveBlob } from "@/lib/calendar";
import { legalWords } from "@/lib/glossary";
import { Shell, BigButton, Loading, CheckCard, Field, Icon, inputClass, ErrorNote } from "@/components/ui";

const EMPTY_EXTRAS = { monthly_rent: null, locked_out: null, utilities_cut: false, rent_period: null };
const EMPTY_FORCE = { locks: null, things: null, threats: null }; // Lagos: is the landlord forcing you out?
const todayIso = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

// Screens: 0 Home → 1 Check the details → 2 Deadline → 3 Answer → 4 Help.
// Everything lives in memory. Refreshing the page erases it. Nothing is saved.
export default function SevenDays() {
  const [place, setPlace] = useState("atlanta"); // "atlanta" | "lagos"
  const [lang, setLang] = useState("en");
  const [step, setStep] = useState(0);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [fields, setFields] = useState(null);
  const [unclear, setUnclear] = useState([]);
  const [readFailed, setReadFailed] = useState(false);
  const [extras, setExtras] = useState(EMPTY_EXTRAS);
  const [result, setResult] = useState(null);
  const [defenses, setDefenses] = useState([]);
  const [picked, setPicked] = useState([]);
  const [ownWords, setOwnWords] = useState("");
  const [phone, setPhone] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const [places, setPlaces] = useState([]);
  const [force, setForce] = useState(EMPTY_FORCE);
  const [calendarSaved, setCalendarSaved] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);
  const [busy, setBusy] = useState(null); // { message, sub } while waiting
  const [error, setError] = useState(null);
  const lastTask = useRef(null);

  const t = STRINGS[lang];
  const isLagos = place === "lagos";

  // Render's free server sleeps when unused. Nudge it awake as soon as the app
  // opens, so it's ready by the time the photo is taken.
  useEffect(() => {
    wakeBackend();
  }, []);

  // Keep <html lang> in step with the chosen language for screen readers.
  useEffect(() => {
    document.documentElement.lang = lang === "es" ? "es" : lang === "pcm" ? "pcm" : "en";
  }, [lang]);

  function choosePlace(p) {
    if (p === place) return;
    clearCase(); // switching city starts a fresh case
    setPlace(p);
    setLang("en");
  }

  // Back one screen. Everything typed so far stays.
  function goBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
    window.scrollTo(0, 0);
  }

  // Runs a backend call with a waiting screen. On failure, the person's work
  // stays on screen and "Try again" repeats the same call.
  async function run(wait, task) {
    lastTask.current = { wait, task };
    setError(null);
    if (wait) setBusy(wait); // quick steps (wait = null) skip the waiting screen
    try {
      await task();
    } catch (err) {
      console.warn(err);
      setError(t.error);
    } finally {
      setBusy(null);
    }
  }
  const retry = () => lastTask.current && run(lastTask.current.wait, lastTask.current.task);

  // ---------- actions ----------

  function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotoUrl(url);
    run({ message: t.reading, sub: t.readingSub, photo: url, steps: place === "lagos" ? t.readingStepsLagos : t.readingSteps }, async () => {
      const r = await readNotice(file, place);
      setFields({ ...r.fields, jurisdiction: place });
      setUnclear(r.unclear || []);
      setReadFailed(r.source === "manual");
      setStep(1);
    });
  }

  function useSample() {
    setPhotoUrl(null);
    setFields({ ...SAMPLE_FIELDS[place] });
    setUnclear([]);
    setReadFailed(false);
    if (place === "lagos") setExtras((x) => ({ ...x, rent_period: "yearly" }));
    setStep(1);
  }

  // Field checks on the Check screen. Dates are never silently replaced.
  const errors = {};
  if (fields && !isLagos && fields.served_on && fields.served_on > todayIso()) errors.served_on = t.errFuture;
  if (fields && isLagos && fields.notice_date && fields.vacate_by && fields.vacate_by < fields.notice_date)
    errors.vacate_by = t.errLeaveBeforeNotice;
  const hasDates = isLagos ? fields?.notice_date && fields?.vacate_by && extras.rent_period : Boolean(fields?.served_on);
  const canConfirm = hasDates && Object.keys(errors).length === 0;

  function confirmFields() {
    run(isLagos ? { message: t.checkingLagos } : { message: t.checking, sub: t.checkingSub }, async () => {
      setResult(await checkNotice(fields, { ...extras, locked_out: Boolean(extras.locked_out) }));
      setStep(2);
    });
  }

  function toAnswer() {
    run(null, async () => {
      if (!isLagos && defenses.length === 0) setDefenses(await getDefenses());
      setStep(3);
    });
  }

  function download() {
    setDownloaded(false);
    run({ message: t.makingPdf, sub: t.makingPdfSub }, async () => {
      const blob = await makeAnswer({
        fields,
        extras: { ...extras, locked_out: Boolean(extras.locked_out) },
        tenant: { phone: phone || null },
        selected_defenses: picked,
        own_words: ownWords,
      });
      saveBlob(blob, isLagos ? "reply-letter-draft.pdf" : "answer-draft.pdf");
      setDownloaded(true);
    });
  }

  // The answer deadline as a calendar file, made on the phone. Never sent anywhere.
  function addToCalendar() {
    if (!deadline) return;
    saveBlob(
      deadlineIcs({ deadline: deadline.deadline, title: t.calTitle, notes: t.calNotes(fields), reminder: t.calReminder }),
      `answer-deadline-${deadline.deadline}.ics`,
    );
    setCalendarSaved(true);
  }

  // One page for legal aid: dates, case, what the person ticked themselves.
  function downloadSummary() {
    setSummarySaved(false);
    run({ message: t.makingSummary, sub: t.makingPdfSub }, async () => {
      const blob = await makeSummary({
        fields,
        extras: { ...extras, locked_out: Boolean(extras.locked_out) },
        tenant: { phone: phone || null },
        selected_defenses: picked,
        own_words: ownWords,
        lagos_force: force,
      });
      saveBlob(blob, "summary-for-legal-aid.pdf");
      setSummarySaved(true);
    });
  }

  function toHelp() {
    run(null, async () => {
      setPlaces((await getLegalAid(place)).places);
      setStep(4);
    });
  }

  function startOver() {
    clearCase();
    setStep(0);
  }

  function clearCase() {
    setPhotoUrl(null);
    setFields(null);
    setResult(null);
    setPicked([]);
    setOwnWords("");
    setPhone("");
    setDownloaded(false);
    setError(null);
    setExtras(EMPTY_EXTRAS);
    setForce(EMPTY_FORCE);
    setCalendarSaved(false);
    setSummarySaved(false);
  }

  const shell = { t, lang, setLang, place, step, demo: DEMO, onBack: goBack };
  const errorNote = <ErrorNote message={error} onRetry={retry} retryLabel={t.retry} />;
  const deadline = result?.deadline;

  // ---------- screens ----------

  if (busy) {
    return (
      <Shell {...shell}>
        {busy.photo ? (
          <PhotoReading photo={busy.photo} steps={busy.steps} sub={busy.sub} />
        ) : (
          <Loading message={busy.message} sub={busy.sub} />
        )}
      </Shell>
    );
  }

  // 0. Home
  if (step === 0) {
    return (
      <Shell
        {...shell}
        footer={
          <div className="space-y-3">
            <BigButton as="label" icon="camera">
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} />
              {t.takePhoto}
            </BigButton>
            <BigButton variant="secondary" icon="file" onClick={useSample}>{t.useSample}</BigButton>
          </div>
        }
      >
        <fieldset>
          <legend className="text-[15px] font-semibold text-ink">{t.whereIsHome}</legend>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {[["atlanta", t.atlanta, t.atlantaSub], ["lagos", t.lagos, t.lagosSub]].map(([value, label, sub]) => {
              const on = place === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => choosePlace(value)}
                  aria-pressed={on}
                  className={`press relative flex min-h-[4.5rem] flex-col items-start justify-center rounded-xl border-2 px-3.5 py-2.5 text-left ${
                    on ? "border-ink bg-ink text-white" : "border-line text-ink hover:border-ink hover:bg-page"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-base font-bold">
                    <Icon name="pin" className="h-4 w-4 shrink-0" />
                    {label}
                  </span>
                  <span className={`mt-0.5 text-sm ${on ? "text-white/85" : "text-ink-soft"}`}>{sub}</span>
                  {on && (
                    <span className="pop absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-mark text-ink">
                      <Icon name="check" className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>

        <h1 className="mt-9 text-[2.1rem] leading-[1.08] font-extrabold tracking-tight text-balance text-ink">
          {isLagos ? t.homeTitleLagos : t.homeTitle}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink">{isLagos ? t.homeBodyLagos : t.homeBody}</p>
        <section className="mt-8" aria-labelledby="how-heading">
          <h2 id="how-heading" className="text-sm font-bold tracking-wide text-ink-soft uppercase">{t.howItWorks}</h2>
          <ol className="mt-3 space-y-2.5">
            {(isLagos ? t.howStepsLagos : t.howSteps).map((line, i) => (
              <li key={line} className="stagger flex items-center gap-3" style={{ "--i": i }}>
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums ${
                    i === 1 ? "bg-mark text-ink" : "bg-page text-ink"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="text-[17px] font-medium">{line}</span>
              </li>
            ))}
          </ol>
        </section>
        <p className="mt-7 flex items-start gap-2 rounded-xl bg-help-soft px-3.5 py-3 text-[15px] leading-relaxed text-help">
          <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" /> {t.privacy}
        </p>
        {errorNote}
      </Shell>
    );
  }

  // 1. Check the details
  if (step === 1) {
    const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value || null }));
    const flag = (k) => unclear.includes(k);
    const describedBy = (id, hint) => [hint && `${id}-hint`, errors[id] && `${id}-error`].filter(Boolean).join(" ") || undefined;
    const fieldInput = (id, extra = {}) => ({
      id,
      className: `${inputClass} ${flag(id) ? "border-mark" : ""} ${errors[id] ? "border-urgent" : ""}`,
      "aria-invalid": errors[id] ? true : undefined,
      ...extra,
    });

    return (
      <Shell
        {...shell}
        footer={
          <>
            {!hasDates && <p className="mb-2.5 text-center text-sm text-ink">{isLagos ? t.needLagosDates : t.needServedDate}</p>}
            <BigButton onClick={confirmFields} disabled={!canConfirm} arrow>{t.confirm}</BigButton>
          </>
        }
      >
        <h1 className="text-[1.65rem] leading-tight font-extrabold tracking-tight">{t.confirmTitle}</h1>
        <p className={`mt-2 text-[15px] leading-relaxed ${readFailed ? "font-semibold text-ink" : "text-ink-soft"}`}>
          {readFailed ? t.couldNotRead : t.confirmBody}
        </p>

        {photoUrl && (
          <a href={photoUrl} target="_blank" rel="noreferrer" aria-label={t.photoLabel} className="mt-4 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="" className="h-36 w-full rounded-xl border border-line bg-page object-contain" />
          </a>
        )}

        <div className="mt-6 space-y-5">
          {isLagos ? (
            <>
              <Field id="notice_date" label={t.fields.notice_date} flagged={flag("notice_date")} flagText={t.unsure}>
                <input type="date" {...fieldInput("notice_date")} value={fields.notice_date ?? ""} onChange={set("notice_date")} aria-describedby={describedBy("notice_date")} />
              </Field>
              <Field id="vacate_by" label={t.fields.vacate_by} flagged={flag("vacate_by")} flagText={t.unsure} error={errors.vacate_by}>
                <input type="date" {...fieldInput("vacate_by")} value={fields.vacate_by ?? ""} onChange={set("vacate_by")} aria-describedby={describedBy("vacate_by")} />
              </Field>
              <Field id="rent_period" label={t.fields.rent_period}>
                <select
                  id="rent_period"
                  className={inputClass}
                  value={extras.rent_period ?? ""}
                  onChange={(e) => setExtras((x) => ({ ...x, rent_period: e.target.value || null }))}
                >
                  <option value="">{t.choose}</option>
                  {Object.entries(t.rentPeriods).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field id="landlord_name" label={t.fields.landlord_name} flagged={flag("landlord_name")} flagText={t.unsure}>
                <input {...fieldInput("landlord_name")} value={fields.landlord_name ?? ""} onChange={set("landlord_name")} />
              </Field>
            </>
          ) : (
            <>
              <Field id="served_on" label={t.fields.served_on} hint={t.fields.served_on_hint} flagged={flag("served_on")} flagText={t.unsure} error={errors.served_on}>
                <input type="date" {...fieldInput("served_on")} value={fields.served_on ?? ""} onChange={set("served_on")} aria-describedby={describedBy("served_on", true)} />
              </Field>
              <Field id="landlord_name" label={t.fields.landlord_name} flagged={flag("landlord_name")} flagText={t.unsure}>
                <input {...fieldInput("landlord_name")} value={fields.landlord_name ?? ""} onChange={set("landlord_name")} />
              </Field>
              <Field id="amount_claimed" label={t.fields.amount_claimed} flagged={flag("amount_claimed")} flagText={t.unsure}>
                <input
                  inputMode="decimal"
                  {...fieldInput("amount_claimed")}
                  value={fields.amount_claimed ?? ""}
                  onChange={(e) => setFields((f) => ({ ...f, amount_claimed: e.target.value === "" ? null : Number(e.target.value) }))}
                />
              </Field>
              <Field id="court" label={t.fields.court} flagged={flag("court")} flagText={t.unsure}>
                <input {...fieldInput("court")} value={fields.court ?? ""} onChange={set("court")} />
              </Field>
              <Field id="case_number" label={t.fields.case_number} flagged={flag("case_number")} flagText={t.unsure}>
                <input {...fieldInput("case_number")} value={fields.case_number ?? ""} onChange={set("case_number")} />
              </Field>

              <section className="border-t border-line pt-6" aria-labelledby="quick-q">
                <h2 id="quick-q" className="text-base font-bold">
                  {t.quickQuestions} <span className="font-normal text-ink-soft">({t.optional})</span>
                </h2>
                <div className="mt-4 space-y-5">
                  <Field id="monthly_rent" label={t.monthlyRent} optional={t.optional}>
                    <input
                      id="monthly_rent"
                      inputMode="decimal"
                      className={inputClass}
                      value={extras.monthly_rent ?? ""}
                      onChange={(e) => setExtras((x) => ({ ...x, monthly_rent: e.target.value === "" ? null : Number(e.target.value) }))}
                    />
                  </Field>
                  <YesNo
                    label={t.lockedOut}
                    yes={t.yes}
                    no={t.no}
                    value={extras.locked_out}
                    onChange={(v) => setExtras((x) => ({ ...x, locked_out: v, utilities_cut: v }))}
                  />
                </div>
              </section>
            </>
          )}
        </div>
        {errorNote}
      </Shell>
    );
  }

  // 2. Deadline
  if (step === 2 && result) {
    const translate = (c) => {
      const tr = t.cards[c.id];
      return tr ? { title: tr.title, body: tr.body({ fields, extras, result }) } : { title: c.title, body: c.body };
    };
    const rank = { red: 0, amber: 1, info: 2 };
    return (
      <Shell
        {...shell}
        footer={<BigButton onClick={toAnswer} arrow>{isLagos ? t.startReply : t.startAnswer}</BigButton>}
      >
        {isLagos ? (
          <LagosVerdict t={t} check={result.notice_check} />
        ) : (
          <Countdown
            t={t}
            d={deadline}
            lang={lang}
            onHelp={toHelp}
            actions={
              <>
                <Listen key={lang} t={t} fields={fields} extras={extras} lang={lang} />
                {deadline && deadline.status !== "missed" && (
                  <CalendarButton t={t} onClick={addToCalendar} saved={calendarSaved} />
                )}
              </>
            }
          />
        )}
        {isLagos && <Listen key={lang} t={t} fields={fields} extras={extras} lang={lang} />}

        {isLagos && <ForceCheck t={t} force={force} setForce={setForce} />}

        <section className="mt-10" aria-labelledby="checks">
          <h2 id="checks" className="text-lg font-bold">{t.thingsToCheck}</h2>
          <ul className="mt-3 space-y-3">
            {result.cards
              // the hero already says these two; don't repeat them as cards
              .filter((c) => !["deadline_missed", "due_today"].includes(c.id))
              .sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3))
              .map((c, i) => <CheckCard key={c.id} index={i} level={c.level} collapsible {...translate(c)} />)}
          </ul>
        </section>

        <LegalWords key={`${place}-${lang}`} t={t} place={place} lang={lang} />
        {errorNote}
      </Shell>
    );
  }

  // 3. Answer
  if (step === 3) {
    return (
      <Shell
        {...shell}
        footer={
          <div className="space-y-3">
            <BigButton variant={downloaded ? "secondary" : "primary"} icon="download" onClick={download}>
              {isLagos ? t.downloadReply : t.downloadAnswer}
            </BigButton>
            {downloaded && (
              <BigButton variant="help" onClick={toHelp} arrow>
                {t.next}
              </BigButton>
            )}
          </div>
        }
      >
        <h1 className="text-[1.65rem] leading-tight font-extrabold tracking-tight">{isLagos ? t.startReply : t.answerTitle}</h1>
        {!isLagos && deadline && deadline.status !== "missed" && (
          <p className="mt-3 inline-flex flex-wrap items-baseline gap-x-1.5 rounded-lg bg-page px-3 py-2 text-[15px]">
            {t.dueBy} <strong className="highlight">{longDate(deadline.deadline, lang)}, {deadline.deadline_time}</strong>
          </p>
        )}

        {!isLagos && (
          <>
            <p className="mt-5 text-lg font-semibold leading-snug">{t.answerBody}</p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{t.answerSupport}</p>
            <fieldset className="mt-5">
              <legend className="sr-only">{t.answerTitle}</legend>
              <ul className="space-y-2">
                {defenses.map((d, i) => {
                  const on = picked.includes(d.id);
                  return (
                    <li key={d.id} className="stagger" style={{ "--i": i }}>
                      <label className={`press flex min-h-14 cursor-pointer gap-3 rounded-xl border-2 px-3.5 py-3 ${on ? "border-ink bg-mark-soft" : "border-line hover:border-ink-soft hover:bg-page"}`}>
                        <input
                          type="checkbox"
                          className="mt-0.5 h-5 w-5 shrink-0 accent-[#15233f]"
                          checked={on}
                          onChange={() => setPicked((p) => (on ? p.filter((x) => x !== d.id) : [...p, d.id]))}
                        />
                        <span className="text-[15px] leading-snug">{t.defenses[d.id] ?? d.text}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <div className="mt-7 space-y-5">
              <Field id="own_words" label={t.ownWords} optional={t.optional}>
                <textarea id="own_words" rows={4} className={inputClass} placeholder={t.ownWordsPlaceholder} value={ownWords} onChange={(e) => setOwnWords(e.target.value)} />
              </Field>
              <Field id="phone" label={t.yourPhone} optional={t.optional} hint={t.phoneHint}>
                <input id="phone" type="tel" autoComplete="tel" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} aria-describedby="phone-hint" />
              </Field>
            </div>
            {t.draftLanguage && <p className="mt-4 text-sm text-ink-soft">{t.draftLanguage}</p>}
          </>
        )}

        {downloaded && (
          <p className="pop mt-6 flex items-center gap-2 font-semibold text-help" role="status">
            <Icon name="check" /> {t.downloaded}
          </p>
        )}
        <section className="mt-6 rounded-2xl bg-page px-4 py-4" aria-labelledby="next-steps">
          <h2 id="next-steps" className="text-lg font-bold">{t.nextStepsTitle}</h2>
          <ol className="mt-3 space-y-3">
            {(isLagos
              ? t.nextStepsLagos
              : t.nextStepsAtlanta(deadline && deadline.status !== "missed" ? `${longDate(deadline.deadline, lang)}, ${deadline.deadline_time}` : null)
            ).map((line, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper text-sm font-bold tabular-nums">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-[15px] leading-relaxed">{line}</span>
              </li>
            ))}
          </ol>
        </section>
        {errorNote}
      </Shell>
    );
  }

  // 4. Help
  return (
    <Shell {...shell} footer={<BigButton variant="secondary" onClick={startOver}>{t.startOver}</BigButton>}>
      <h1 className="text-[1.65rem] leading-tight font-extrabold tracking-tight text-balance">{isLagos ? t.helpTitleLagos : t.helpTitle}</h1>
      {!isLagos && deadline && deadline.status !== "missed" && (
        <p className="mt-4 text-lg leading-snug">
          {t.answerBy} <strong className="highlight">{longDate(deadline.deadline, lang)}, {deadline.deadline_time}</strong>
        </p>
      )}
      <p className="mt-3 text-[15px] leading-relaxed text-ink">{t.helpBody}</p>

      <div className="mt-6 rounded-2xl bg-page p-4">
        <BigButton variant="help" icon="file" onClick={downloadSummary}>{t.summaryButton}</BigButton>
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink">{t.summaryHint}</p>
        {summarySaved && (
          <p className="mt-2 flex items-center gap-2 font-semibold text-help" role="status">
            <Icon name="check" className="pop h-5 w-5" /> {t.summarySaved}
          </p>
        )}
      </div>
      {!isLagos && deadline && deadline.status !== "missed" && (
        <CalendarButton t={t} onClick={addToCalendar} saved={calendarSaved} />
      )}

      <ul className="mt-6 space-y-3">
        {places.map((p, i) => (
          <li key={p.name} className="stagger rounded-xl border-2 border-help-soft bg-paper px-4 py-4" style={{ "--i": i }}>
            <p className="text-[17px] font-bold leading-snug text-ink">{p.name}</p>
            {p.address && <p className="mt-1 text-[15px]">{p.address}</p>}
            {p.phone && (
              <a href={`tel:${p.phone}`} className="mt-2 inline-flex min-h-11 items-center font-semibold text-help underline underline-offset-4">
                {p.phone}
              </a>
            )}
            {p.website && (
              <a
                href={p.website}
                target="_blank"
                rel="noreferrer"
                aria-label={t.visitSiteLabel(p.name)}
                className="mt-1 flex min-h-11 items-center gap-1.5 font-semibold text-help underline underline-offset-4"
              >
                {t.visitSite(p.name)} <Icon name="arrow" className="h-4 w-4" />
              </a>
            )}
            {p.verify && <p className="mt-1 text-sm text-ink-soft">{t.checkDetails}</p>}
          </li>
        ))}
      </ul>
      {!isLagos && <p className="mt-6 text-[15px] leading-relaxed">{t.fileWhere}</p>}
      <p className="mt-6 text-sm text-ink-soft">{t.startOverNote}</p>
      {errorNote}
    </Shell>
  );
}

// ---------- pieces used above ----------

// The big number ticks from 0 up to its value once, drawing the eye to the
// deadline. Screen readers and reduced-motion users get the final number at once.
function CountTo({ value }) {
  // This screen only appears after a tap, so window always exists here.
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) return;
    const steps = Math.min(Math.max(value, 1), 15);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setShown(Math.round((value * n) / steps));
      if (n >= steps) clearInterval(id);
    }, 550 / steps);
    return () => clearInterval(id);
  }, [value, reduced]);
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}

function longDate(isoDate, lang) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(LOCALE[lang] || "en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function YesNo({ label, yes, no, value, onChange }) {
  return (
    <fieldset>
      <legend className="text-[15px] font-semibold text-ink">{label}</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[[true, yes], [false, no]].map(([v, l]) => (
          <button
            key={l}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`press flex min-h-12 items-center justify-center gap-1.5 rounded-xl border-2 font-semibold ${
              value === v ? "border-ink bg-ink text-white" : "border-line hover:border-ink hover:bg-page"
            }`}
          >
            {value === v && <Icon name="check" className="pop h-4 w-4" />}
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// The deadline hero: the number with the highlighter, the date, how it was
// counted, and what it means. Three states: open, due today, possibly missed.
function Countdown({ t, d, lang, onHelp, actions }) {
  if (!d) return null;
  return (
    <section aria-labelledby="deadline-heading" aria-live="polite">
      <p className="text-[15px] font-semibold text-ink-soft">{t.yourDeadline}</p>

      {d.status === "missed" && (
        <>
          <h1 id="deadline-heading" className="mt-2 flex items-start gap-2.5 text-[1.75rem] leading-tight font-extrabold">
            <span className="mt-1 text-urgent"><Icon name="alert" className="h-7 w-7" /></span>
            {t.missed}
          </h1>
          <p className="mt-3 text-lg leading-relaxed">{t.missedBody}</p>
          <div className="mt-5">
            <BigButton variant="help" onClick={onHelp}>{t.getHelpNow}</BigButton>
          </div>
        </>
      )}

      {d.status === "due_today" && (
        <>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-urgent px-3 py-1 text-sm font-bold text-white">
            <Icon name="alert" className="h-4 w-4" /> {t.dueTodayBadge}
          </p>
          <h1 id="deadline-heading" className="mt-3">
            <span className="highlight text-[clamp(3rem,17vw,4.5rem)] leading-none font-extrabold tracking-tight whitespace-nowrap tabular-nums">
              {d.deadline_time}
            </span>
          </h1>
          <p className="mt-4 text-xl leading-snug">{t.dueTodayBody}</p>
        </>
      )}

      {d.status === "open" && (
        <>
          <h1 id="deadline-heading" className="mt-1 flex items-end gap-3">
            <span className="highlight text-[clamp(5.5rem,27vw,7rem)] leading-[0.95] font-extrabold tracking-tighter tabular-nums">
              <CountTo value={d.days_left} />
            </span>
            <span className="pb-3 text-2xl font-bold">{t.daysLeft(d.days_left)}</span>
          </h1>
          <p className="mt-5 text-xl leading-snug">
            {t.answerBy} <strong>{longDate(d.deadline, lang)}</strong>
          </p>
          <p className="text-[1.65rem] font-extrabold tracking-tight">{d.deadline_time}</p>
        </>
      )}

      {actions}
      {d.status !== "missed" && <DayStrip t={t} d={d} lang={lang} />}
      {d.status !== "missed" && <p className="mt-5 text-[15px] leading-relaxed text-ink">{t.deadlineMeans}</p>}
    </section>
  );
}

// Every day from service to deadline, so people can see the weekends count and
// why the deadline moved. Only shows what the deadline logic returned.
function DayStrip({ t, d, lang }) {
  const start = new Date(`${d.served_on}T00:00:00Z`);
  const end = new Date(`${d.deadline}T00:00:00Z`);
  const days = [];
  for (let x = start; x <= end; x = new Date(x.getTime() + 86400000)) days.push(x);
  if (days.length > 15) return null;
  const locale = LOCALE[lang] || "en-US";
  const fmt = (x, o) => x.toLocaleDateString(locale, { ...o, timeZone: "UTC" });
  const seventh = new Date(`${d.seventh_day}T00:00:00Z`);
  const seventhClosed = closedLabel(d.seventh_day);
  const closedName = seventhClosed && ["Saturday", "Sunday"].includes(seventhClosed) ? fmt(seventh, { weekday: "long" }) : seventhClosed;

  return (
    <figure className="mt-7">
      <figcaption className="text-[15px] font-semibold">{t.stripLabel}</figcaption>
      <ol className="mt-3 grid grid-cols-5 gap-1.5" aria-label={t.stripLabel}>
        {days.map((x, i) => {
          const iso = x.toISOString().slice(0, 10);
          const isDue = iso === d.deadline;
          const isServed = i === 0;
          const closed = !isServed && !isDue && iso >= d.seventh_day;
          const label = isServed ? t.servedOn : isDue ? t.dueLabel : i <= 7 ? `${t.day} ${i}` : "";
          const style = isDue
            ? "bg-mark text-ink font-bold"
            : isServed
              ? "bg-ink text-white"
              : closed
                ? "border border-dashed border-ink-soft/60 text-ink-soft"
                : "bg-page text-ink";
          return (
            <li key={iso} className={`relative flex min-w-0 flex-col items-center rounded-lg py-2 text-center ${style}`}>
              <span className="text-[11px]">{fmt(x, { weekday: "short" })}</span>
              <span className={`text-lg leading-tight tabular-nums ${closed ? "line-through" : ""}`}>{fmt(x, { day: "numeric" })}</span>
              <span className="mt-0.5 text-[10px] leading-tight">{label}</span>
              {closed && <span className="sr-only">{t.closedDay}</span>}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        {d.moved && closedName ? t.movedBecause(closedName) : t.weekendsCount}
      </p>
    </figure>
  );
}

function LagosVerdict({ t, check }) {
  if (!check) return null;
  return (
    <section aria-labelledby="notice-heading" aria-live="polite">
      <p className="text-[15px] font-semibold text-ink-soft">{t.yourNotice}</p>
      <h1 id="notice-heading" className="mt-1 flex items-end gap-3">
        <span className="highlight text-[clamp(5.5rem,27vw,7rem)] leading-[0.95] font-extrabold tracking-tighter tabular-nums">
          {check.given_days}
        </span>
        <span className="pb-3 text-2xl font-bold">{t.days}</span>
      </h1>
      {check.required_days && (
        <figure className="mt-5">
          <div
            className="h-4 w-full overflow-hidden rounded-full bg-page"
            role="img"
            aria-label={t.noticeBar(check.given_days, check.required_days)}
          >
            <div
              className={`grow-bar h-full rounded-full ${check.ok === false ? "bg-caution" : "bg-help"}`}
              style={{ width: `${Math.max(3, Math.min(100, (check.given_days / check.required_days) * 100))}%` }}
            />
          </div>
          <figcaption className="mt-1.5 flex justify-between text-sm font-semibold">
            <span className={check.ok === false ? "text-caution" : "text-help"}>{t.noticeGiven(check.given_days)}</span>
            <span className="text-ink-soft">{t.noticeNeeded(check.required_days)}</span>
          </figcaption>
        </figure>
      )}
      <p className="mt-5 flex items-start gap-2 text-xl leading-snug">
        {check.ok === false && <span className="mt-1 text-caution"><Icon name="option" /></span>}
        {check.ok === false ? t.lagosNoticeTitle(check.given_days, check.required_days) : t.lagosLooksOk}
      </p>
      {check.required_days && <p className="mt-3 text-[15px] leading-relaxed text-ink">{t.lagosAgreement}</p>}
      {!check.verified && <p className="mt-2 text-[15px] text-ink-soft">{t.lagosProvisional}</p>}
    </section>
  );
}

// Fetches the plain-language script, shows it as captions, and plays it.
function Listen({ t, fields, extras, lang }) {
  const [state, setState] = useState("idle"); // idle | loading | playing
  const [text, setText] = useState(null);
  const [noAudio, setNoAudio] = useState(false);
  const audio = useRef(null);

  useEffect(() => () => audio.current?.pause(), []);

  async function toggle() {
    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    setNoAudio(false);
    try {
      const ex = await explainNotice(fields, { ...extras, locked_out: Boolean(extras.locked_out) }, lang);
      setText(ex.text);
      const blob = await speak(ex.spoken || ex.text, voiceFor(fields.jurisdiction, lang));
      if (!blob) {
        setNoAudio(true);
        return setState("idle");
      }
      audio.current = new Audio(URL.createObjectURL(blob));
      audio.current.onended = () => setState("idle");
      await audio.current.play();
      setState("playing");
    } catch (e) {
      console.warn(e);
      setNoAudio(true);
      setState("idle");
    }
  }

  return (
    <div className="mt-8">
      <BigButton variant="secondary" onClick={toggle} disabled={state === "loading"} aria-pressed={state === "playing"}>
        <Icon name={state === "playing" ? "pause" : "speaker"} />
        {state === "loading" ? t.listening : state === "playing" ? t.stop : t.listen}
      </BigButton>
      <div aria-live="polite">
        {noAudio && <p className="mt-3 text-[15px] text-ink-soft">{t.noAudio}</p>}
        {text && (
          <div className="mt-3 rounded-xl bg-page px-4 py-3">
            <p className="text-sm font-semibold text-ink-soft">{t.captionsLabel}</p>
            <p className="mt-1 text-[15px] leading-relaxed">{text}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Saves the deadline as a calendar file with reminders. Made on the phone.
function CalendarButton({ t, onClick, saved }) {
  return (
    <div className="mt-6">
      <BigButton variant="secondary" icon="calendar" onClick={onClick}>{t.addToCalendar}</BigButton>
      <p className="mt-2 text-sm text-ink-soft" aria-live="polite">
        {saved ? (
          <span className="flex items-center gap-1.5 font-semibold text-help">
            <Icon name="check" className="pop h-4 w-4" /> {t.calendarSaved}
          </span>
        ) : (
          t.calendarHint
        )}
      </p>
    </div>
  );
}

// Lagos: three yes/no questions. Any "yes" means the landlord may be breaking
// the law, so we say so plainly and list what to do. Nothing is pre-chosen.
function ForceCheck({ t, force, setForce }) {
  const answers = Object.values(force);
  const anyYes = answers.some((v) => v === true);
  const allNo = answers.every((v) => v === false);
  return (
    <section className="mt-10 border-t border-line pt-7" aria-labelledby="force-heading">
      <h2 id="force-heading" className="text-lg font-bold">{t.forceTitle}</h2>
      <p className="mt-1 text-[15px] text-ink-soft">{t.forceSub}</p>
      <div className="mt-4 space-y-5">
        {Object.entries(t.forceQ).map(([k, q]) => (
          <YesNo key={k} label={q} yes={t.yes} no={t.no} value={force[k]} onChange={(v) => setForce((f) => ({ ...f, [k]: v }))} />
        ))}
      </div>
      <div aria-live="polite">
        {anyYes && (
          <div className="pop mt-5 rounded-r-xl border-l-4 border-urgent bg-urgent-soft px-4 py-4">
            <p className="flex items-center gap-2 text-lg font-bold text-urgent">
              <Icon name="alert" /> {t.forceIllegalTitle}
            </p>
            <p className="mt-1.5 text-[15px] leading-relaxed">{t.forceIllegalBody}</p>
            <p className="mt-3 font-semibold">{t.forceStepsTitle}</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[15px] leading-relaxed">
              {t.forceSteps.map((line) => <li key={line}>{line}</li>)}
            </ol>
          </div>
        )}
        {allNo && <p className="mt-5 rounded-xl bg-help-soft px-4 py-3 text-[15px] leading-relaxed text-help">{t.forceNone}</p>}
      </div>
    </section>
  );
}

// Tap a legal word: its plain meaning opens below, and "Hear it" reads it aloud.
// Meanings are written by the team (lib/glossary.js), never made up by AI.
function LegalWords({ t, place, lang }) {
  const words = legalWords(place, lang);
  const [open, setOpen] = useState(null);
  const [state, setState] = useState("idle"); // idle | loading | playing
  const [noAudio, setNoAudio] = useState(false);
  const audio = useRef(null);
  const cache = useRef({});

  useEffect(() => () => audio.current?.pause(), []);

  function choose(id) {
    audio.current?.pause();
    setState("idle");
    setNoAudio(false);
    setOpen(open === id ? null : id);
  }

  async function hear(w) {
    if (state === "playing") {
      audio.current?.pause();
      return setState("idle");
    }
    setState("loading");
    setNoAudio(false);
    try {
      if (!cache.current[w.id]) {
        const blob = await speak(`${w.word}. ${w.meaning}`, voiceFor(place, lang));
        if (!blob) {
          setNoAudio(true);
          return setState("idle");
        }
        cache.current[w.id] = URL.createObjectURL(blob);
      }
      audio.current = new Audio(cache.current[w.id]);
      audio.current.onended = () => setState("idle");
      await audio.current.play();
      setState("playing");
    } catch (e) {
      console.warn(e);
      setNoAudio(true);
      setState("idle");
    }
  }

  const current = words.find((w) => w.id === open);
  return (
    <section className="mt-10" aria-labelledby="words-heading">
      <h2 id="words-heading" className="text-lg font-bold">{t.legalWordsTitle}</h2>
      <p className="mt-1 text-[15px] text-ink-soft">{t.legalWordsSub}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {words.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => choose(w.id)}
              aria-expanded={open === w.id}
              aria-controls="word-meaning"
              className={`press min-h-11 rounded-full border-2 px-3.5 text-[15px] font-semibold ${
                open === w.id ? "border-ink bg-ink text-white" : "border-line text-ink hover:border-ink hover:bg-page"
              }`}
            >
              {w.word}
            </button>
          </li>
        ))}
      </ul>
      <div id="word-meaning" aria-live="polite">
        {current && (
          <div key={current.id} className="pop mt-3 rounded-xl bg-mark-soft px-4 py-3.5">
            <p className="font-bold">{current.word}</p>
            <p className="mt-1 text-[15px] leading-relaxed">{current.meaning}</p>
            <button
              type="button"
              onClick={() => hear(current)}
              disabled={state === "loading"}
              aria-pressed={state === "playing"}
              className="press mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-ink bg-paper px-3.5 font-semibold disabled:opacity-50"
            >
              <Icon name={state === "playing" ? "pause" : "speaker"} className="h-5 w-5" />
              {state === "loading" ? t.listening : state === "playing" ? t.stop : t.hearWord}
            </button>
            {noAudio && <p className="mt-2 text-sm text-ink-soft">{t.noAudio}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

// While the photo is read: the photo itself with a scanning line, and short
// steps that change every ~2 seconds so the wait feels like progress.
function PhotoReading({ photo, steps, sub }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), 2000);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <div className="flex flex-col items-center py-10 text-center" role="status" aria-live="polite">
      <div className="relative w-full max-w-[16rem] overflow-hidden rounded-2xl border border-line bg-page">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt="" className="h-72 w-full object-cover opacity-90" />
        <div aria-hidden="true" className="scan-line absolute inset-x-0 h-16" />
      </div>
      <p key={i} className="pop mt-7 text-xl font-semibold text-ink">{steps[i]}</p>
      {sub && <p className="mt-2 max-w-xs text-[15px] text-ink-soft">{sub}</p>}
    </div>
  );
}
