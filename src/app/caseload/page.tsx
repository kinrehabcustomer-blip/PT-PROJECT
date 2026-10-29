"use client";

import { useState } from "react";
import { remainingSessions } from "@/domain/models";
import { useApp } from "@/presentation/state/app-context";

/** Which patients are in each therapist's care. Staff pick a therapist and add patients from a dropdown. */
export default function CaseloadPage() {
  const { data, user, role, act } = useApp();
  const [pickedTherapist, setPickedTherapist] = useState("");
  const [pickedPatient, setPickedPatient] = useState("");
  if (!data) return null;

  const isTherapist = role === "therapist";
  const therapistId = isTherapist ? (user?.therapistId ?? "") : pickedTherapist || data.therapists[0]?.id || "";
  const therapist = data.therapists.find((t) => t.id === therapistId);
  const inCare = data.assignments
    .filter((a) => a.therapistId === therapistId)
    .map((a) => data.patients.find((p) => p.id === a.patientId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const inCareIds = new Set(inCare.map((p) => p.id));
  const available = data.patients.filter((p) => !inCareIds.has(p.id));

  const change = (patientId: string, remove: boolean) =>
    act("POST", `/api/therapists/${therapistId}/patients`, { patientId, remove }, remove ? "นำออกจากความดูแลแล้ว" : "เพิ่มเข้าความดูแลแล้ว");

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{isTherapist ? "ผู้ป่วยในความดูแลของฉัน" : "การดูแลผู้รับบริการ"}</h1>
          <p>{isTherapist ? "รายชื่อผู้ป่วยที่เจ้าหน้าที่มอบหมายให้คุณ" : "เลือกนักกายภาพ แล้วเพิ่มผู้รับบริการที่อยู่ในความดูแลของคนนั้น"}</p>
        </div>
      </div>

      {!isTherapist && (
        <section className="panel stack-pad" style={{ marginBottom: 16 }}>
          <div className="adjust-form">
            <label>นักกายภาพบำบัด
              <select value={therapistId} onChange={(e) => { setPickedTherapist(e.target.value); setPickedPatient(""); }}>
                {data.therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>เพิ่มผู้รับบริการเข้าความดูแล
              <select value={pickedPatient} onChange={(e) => setPickedPatient(e.target.value)} disabled={!available.length}>
                <option value="">{available.length ? "— เลือกผู้รับบริการ —" : "ทุกคนอยู่ในความดูแลแล้ว"}</option>
                {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <button
              className="primary-button"
              disabled={!pickedPatient}
              onClick={async () => { if (await change(pickedPatient, false)) setPickedPatient(""); }}
            >＋ เพิ่ม</button>
          </div>
        </section>
      )}

      <section className="panel stack-pad">
        <div className="panel-title">{therapist?.name ?? "—"} · ผู้ป่วยในความดูแล {inCare.length} คน</div>
        {inCare.length === 0 && <div className="empty-state">ยังไม่มีผู้รับบริการในความดูแล</div>}
        {inCare.map((p) => {
          const courses = data.courses.filter((c) => c.patientId === p.id);
          const next = data.appointments
            .filter((a) => a.patientId === p.id && (a.status === "รอยืนยัน" || a.status === "ยืนยันแล้ว"))
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0];
          return (
            <div className="history-line" key={p.id}>
              <span>
                <strong>{p.name}</strong> · {p.phone}
                <div className="ack-note">{p.condition || "ไม่ระบุอาการ"}</div>
                <div className="ack-note">
                  คอร์ส: {courses.map((c) => `${c.serviceName} เหลือ ${remainingSessions(c)}/${c.totalSessions}`).join(" · ") || "ยังไม่มี"}
                  {" "}· นัดถัดไป: {next ? `${next.date} ${next.time} น.` : "ไม่มี"}
                </div>
              </span>
              {!isTherapist && (
                <span className="appointment-actions">
                  <button className="row-action danger" onClick={() => window.confirm(`นำ ${p.name} ออกจากความดูแลของ ${therapist?.name}?`) && change(p.id, true)}>นำออก</button>
                </span>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
