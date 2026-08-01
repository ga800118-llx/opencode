import { describe, expect, test } from "bun:test"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"

const primaryTaskCopy = {
  "command.category.session": ["Tasks", "任务"],
  "command.session.new": ["New task", "新建任务"],
  "command.session.previous": ["Previous task", "上一个任务"],
  "command.session.next": ["Next task", "下一个任务"],
  "command.session.previous.unseen": ["Previous unread task", "上一个未读任务"],
  "command.session.next.unseen": ["Next unread task", "下一个未读任务"],
  "command.session.archive": ["Archive task", "归档任务"],
  "notification.action.goToSession": ["Go to task", "前往任务"],
  "home.sessions.search.placeholder": ["Search tasks", "搜索任务"],
  "home.sessions.search.placeholder.scoped": ["Search tasks in {{scope}}", "在 {{scope}} 中搜索任务"],
  "home.sessions.search.sessions": ["Tasks", "任务"],
  "home.sessions.search.noResults": ["No tasks found for {{query}}", "未找到与 {{query}} 相关的任务"],
  "home.sessions.empty": ["No tasks", "暂无任务"],
  "home.sessions.empty.description": ["Create a task to get started", "创建一个任务以开始。"],
  "sidebar.nav.projectsAndSessions": ["Projects and tasks", "项目和任务"],
  "sidebar.project.recentSessions": ["Recent tasks", "最近任务"],
  "sidebar.project.viewAllSessions": ["View all tasks", "查看全部任务"],
} as const

describe("primary task workflow copy", () => {
  test.each(Object.entries(primaryTaskCopy))("uses task terminology for %s", (key, [english, chinese]) => {
    expect(en[key as keyof typeof en]).toBe(english)
    expect(zh[key as keyof typeof zh]).toBe(chinese)
  })
})
