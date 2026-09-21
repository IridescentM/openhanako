import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder, { type PlaceholderOptions } from '@tiptap/extension-placeholder';
import { SkillBadge } from './extensions/skill-badge';
import { FileBadge } from './extensions/file-badge';

export type InputEditorPlaceholder = PlaceholderOptions['placeholder'];

export function createInputEditorExtensions(placeholder: InputEditorPlaceholder): Extensions {
  // 聊天输入框是“字面文本”编辑器：用户敲什么就发什么。
  // StarterKit 自带的 markdown input rules 会把 `x` / *x* / _x_ / ~~x~~ / **x** / - 列表
  // 立即转成富文本 mark（输入字符当场“被吃掉”），而 serializeEditor 只取纯文本，
  // 格式标记不会还原，导致特殊字符在发送链路中彻底丢失。
  // 因此这里禁用所有会产生 mark/list 的扩展，只保留段落/换行/撤销。
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      link: false,
      bold: false,
      italic: false,
      strike: false,
      code: false,
      underline: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
    }),
    Placeholder.configure({ placeholder }),
    SkillBadge,
    FileBadge,
  ];
}
