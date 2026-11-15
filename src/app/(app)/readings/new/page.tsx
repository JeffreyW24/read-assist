import { requireUser } from "@/lib/auth";
import { coursesForUser } from "@/lib/db";
import { geminiConfigured } from "@/lib/gemini";
import { PageHeader } from "@/components/AppShell";
import { NewReadingForm } from "./NewReadingForm";

export default async function NewReadingPage({ searchParams }: PageProps<"/readings/new">) {
  const user = await requireUser();
  const { courseId } = await searchParams;
  const courses = user.role === "professor" ? (await coursesForUser(user)).map((c) => ({ id: c.id, label: `${c.code}: ${c.name}` })) : [];
  return (
    <div className="max-w-3xl">
      <PageHeader
        title={user.role === "professor" ? "Post a reading" : "Upload a reading"}
        subtitle={
          user.role === "professor"
            ? "Paste the text or upload a PDF. Students will read it in the eyeRead reader."
            : "Practice with anything you've been assigned: paste text or upload a PDF."
        }
      />
      <NewReadingForm
        role={user.role}
        courses={courses}
        defaultCourseId={typeof courseId === "string" ? courseId : courses[0]?.id}
        aiAvailable={geminiConfigured()}
      />
    </div>
  );
}
