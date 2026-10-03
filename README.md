# Astro Spectrum & Filter Viewer

GitHub Pagesだけで動く、天体スペクトル + filter response curve のGUIビューアです。
サーバー側計算は不要で、スペクトルの処理・描画・簡易synthetic photometryはブラウザ内で行います。

## Features

- 複数スペクトルを同時表示
  - Blackbodyを何個でも追加
  - 複数CSV / TXT / DATを同時upload
  - spectrumごとの show/hide、色、名前、redshift
- `F_lambda` / `F_nu` 表示切替
- observed-frame / rest-frame 波長切替
- common emission lines のON/OFF
- `filters/` 内のfilter curveを自動一覧化
- filterごとの show/hide とカラーピッカー
- Plotlyによる zoom / pan / hover
- filter pivot wavelength
- absolute flux spectrum に対する synthetic AB magnitude
- GitHub Pagesへ自動deploy

## Repository structure

```text
.
├── index.html
├── app.js
├── styles.css
├── README.md
├── filters/
│   ├── README.md
│   ├── example_filter.csv
│   └── index.json
├── scripts/
│   └── build_filter_index.py
└── .github/
    └── workflows/
        └── pages.yml
```

## GitHubで公開する

1. このファイル一式をGitHub repositoryへpush
2. repositoryの `Settings` → `Pages`
3. `Build and deployment` → `Source` を `GitHub Actions` に設定
4. `main` branchへpush

以後、pushごとに自動deployされます。

公開URLは通常:

```text
https://<USERNAME>.github.io/<REPOSITORY>/
```

## Filterを追加する

`filters/` にファイルを追加するだけです。

```csv
# name: My Telescope / Filter X
# wavelength_unit: angstrom
# color: #2f80ed
wavelength,throughput
3500,0.00
3600,0.05
3700,0.20
...
```

pushするとGitHub Actionsが `filters/index.json` を自動生成します。
`index.json` を手で編集する必要はありません。

対応波長単位:

- `nm`
- `angstrom`
- `um`

対応拡張子:

- `.csv`
- `.txt`
- `.dat`

`# color:` は省略可能です。GUI側のカラーピッカーでもfilter色を変更できます。

## Spectrum upload

最小形式は2列です。

```csv
wavelength,flux
400,1.2e-15
401,1.25e-15
...
```

GUIでdefault wavelength unit / flux unitを選んでからuploadできます。
ファイルのコメントmetadataを使うと、ファイルごとに設定を保持できます。

### Relative F_lambda example

```csv
# name: Galaxy template
# wavelength_unit: angstrom
# flux_unit: relative_flam
# frame: rest
# redshift: 1.2
wavelength,flux
3500,0.72
3510,0.73
...
```

### Absolute F_lambda example

```csv
# name: Observed target A
# wavelength_unit: angstrom
# flux_unit: erg/s/cm2/angstrom
# frame: observed
# redshift: 0.35
wavelength,flux
4000,1.20e-17
4010,1.24e-17
...
```

### Absolute F_nu example

```csv
# name: Target in Jy
# wavelength_unit: nm
# flux_unit: Jy
# frame: observed
wavelength,flux
400,1.4e-6
401,1.5e-6
...
```

### Supported `flux_unit`

- `relative_flam`
- `relative_fnu`
- `erg/s/cm2/angstrom`
- `erg/s/cm2/nm`
- `Jy`
- `erg/s/cm2/Hz`

## F_lambda / F_nu

GUIの `Flux display` から切り替えます。
absolute fluxの場合、内部で以下の関係を使って変換します。

```text
F_nu = F_lambda * lambda^2 / c
```

`Normalize each spectrum for plot` がONなら、描画だけ各スペクトルの最大絶対値でnormalizeします。
AB magnitude計算はnormalize前の元データを使います。

## observed / rest frame

各スペクトルはそれぞれの `z` を使って波長軸を変換します。

```text
lambda_obs = lambda_rest * (1 + z)
```

複数天体でredshiftが異なるため、filterとemission-line annotationには
`Reference spectrum for filters / lines` で指定した天体の `z` を使います。

- observed-frame表示: filterは元のobserver-frame bandpass
- rest-frame表示: filter wavelengthを `1 + z_ref` で割って表示
- emission lines: observed-frameでは `z_ref` でshift、rest-frameではrest wavelengthに表示

`frame: rest` のabsolute-flux spectrumは、波長座標がderedshift済みのobserver flux densityとして扱います。
flux densityそのものにluminosity-distance補正等は行いません。

## Synthetic AB magnitude

`Synthetic AB magnitude` をONにすると、absolute fluxを持つupload spectrumについてfilterごとのAB magnitudeを表示します。
relative spectrumとBlackbodyは絶対normalizationがないため `N/A` になります。

photon-counting responseを想定し、observer frameで概ね

```text
<f_nu> = integral[ f_nu(lambda) T(lambda) / lambda d lambda ]
         / integral[ T(lambda) / lambda d lambda ]

m_AB = -2.5 log10(<f_nu> / 3631 Jy)
```

を計算します。スペクトルがfilterの有効範囲を十分coverしていない場合はAB magnitudeを出しません。

> 注: 精密な装置photometryでは、filter curveがenergy responseかphoton responseか、atmosphere / optics / detectorをどこまで含むかなどを確認してください。このviewerは汎用の簡易synthetic-photometry GUIです。

## Emission lines

現在のbuilt-in line list:

- Lyα
- C IV
- C III]
- Mg II
- [O II]
- Hβ
- [O III]
- Hα
- [N II]
- [S II]

`app.js` の `EMISSION_LINES` を編集すれば追加・削除できます。

## ローカルで確認

ブラウザから `file://` で直接開くと `fetch()` が制限されることがあります。

```bash
python3 scripts/build_filter_index.py
python3 -m http.server 8000
```

その後:

```text
http://localhost:8000
```

## Notes

- `example_filter.csv` はGUI動作確認用の架空response curveです。
- Blackbodyはshape比較用のrelative spectrumです。
- filterファイルはGitHub repositoryに置くだけで一覧へ反映されます。
