import type { AppData } from "@/domain/models";

export function CourseList({
  data,
  expandedCourse,
  onToggle,
}: {
  data: AppData;
  expandedCourse: string | null;
  onToggle: (courseId: string) => void;
}) {
  const coursesNearEnd = data.courses.filter((course) => course.totalSessions - course.usedSessions <= 3);

  return (
    <section className="panel">
      <div className="panel-header"><div><div className="panel-title">คอร์สใกล้หมด</div><div className="panel-subtitle">ติดตามจำนวนครั้งคงเหลือ</div></div></div>
      <div className="course-list">
        {coursesNearEnd.length ? coursesNearEnd.map((course) => {
          const patient = data.patients.find(({ id }) => id === course.patientId);
          const remaining = course.totalSessions - course.usedSessions;
          return (
            <div className="course-item" key={course.id}>
              <button className="course-expand" onClick={() => onToggle(course.id)} aria-expanded={expandedCourse === course.id}>
                <div className="course-top"><span className="course-name">{patient?.name}</span><span className="course-count">เหลือ {remaining}/{course.totalSessions}</span></div>
                <div className="progress-track"><div className={`progress-fill ${remaining === 0 ? "exhausted" : "warning"}`} style={{ width: `${course.usedSessions / course.totalSessions * 100}%` }} /></div>
                <div className="course-foot"><span>{course.serviceName}</span><span className="alert-label">{remaining === 0 ? "ครบคอร์ส" : "ใกล้หมด"}</span></div>
              </button>
              {expandedCourse === course.id && <div className="course-history">
                <strong>ประวัติการรักษา</strong>
                {course.history.length
                  ? course.history.filter((entry) => !entry.voided).map((entry) => <div key={entry.id}>{entry.date} · {entry.therapistName}<small>{entry.serviceName}</small></div>)
                  : <div>ยังไม่มีประวัติการรักษาในตัวอย่างนี้</div>}
              </div>}
            </div>
          );
        }) : <div className="empty-state">ยังไม่มีคอร์สใกล้หมด</div>}
      </div>
    </section>
  );
}
