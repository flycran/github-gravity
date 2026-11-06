/**
 * 4 周确定性贡献数据：全部 fixtures 共享同一份，修改只改这里。
 * 纯数据（可 JSON 序列化），driver 注入被测 ref 时仍以 JSON 落盘。
 */
export const calendarList = {
  total: 226,
  contributions: [
    [
      {
        date: '2026-01-04',
        intensity: 0,
        count: 0
      },
      {
        date: '2026-01-05',
        intensity: 1,
        count: 3
      },
      {
        date: '2026-01-06',
        intensity: 2,
        count: 8
      },
      {
        date: '2026-01-07',
        intensity: 3,
        count: 15
      },
      {
        date: '2026-01-08',
        intensity: 2,
        count: 7
      },
      {
        date: '2026-01-09',
        intensity: 1,
        count: 2
      },
      {
        date: '2026-01-10',
        intensity: 0,
        count: 0
      }
    ],
    [
      {
        date: '2026-01-11',
        intensity: 3,
        count: 15
      },
      {
        date: '2026-01-12',
        intensity: 4,
        count: 25
      },
      {
        date: '2026-01-13',
        intensity: 2,
        count: 8
      },
      {
        date: '2026-01-14',
        intensity: 0,
        count: 0
      },
      {
        date: '2026-01-15',
        intensity: 1,
        count: 3
      },
      {
        date: '2026-01-16',
        intensity: 2,
        count: 8
      },
      {
        date: '2026-01-17',
        intensity: 3,
        count: 15
      }
    ],
    [
      {
        date: '2026-01-18',
        intensity: 1,
        count: 4
      },
      {
        date: '2026-01-19',
        intensity: 2,
        count: 6
      },
      {
        date: '2026-01-20',
        intensity: 0,
        count: 0
      },
      {
        date: '2026-01-21',
        intensity: 2,
        count: 9
      },
      {
        date: '2026-01-22',
        intensity: 4,
        count: 22
      },
      {
        date: '2026-01-23',
        intensity: 3,
        count: 12
      },
      {
        date: '2026-01-24',
        intensity: 1,
        count: 5
      }
    ],
    [
      {
        date: '2026-01-25',
        intensity: 2,
        count: 7
      },
      {
        date: '2026-01-26',
        intensity: 3,
        count: 14
      },
      {
        date: '2026-01-27',
        intensity: 1,
        count: 5
      },
      {
        date: '2026-01-28',
        intensity: 1,
        count: 4
      },
      {
        date: '2026-01-29',
        intensity: 0,
        count: 0
      },
      {
        date: '2026-01-30',
        intensity: 2,
        count: 9
      },
      {
        date: '2026-01-31',
        intensity: 4,
        count: 20
      }
    ]
  ]
} as const
