#include <drogon/drogon.h>
#include <libpq-fe.h>
#include <curl/curl.h>
#include <fstream>
#include <string>
#include <vector>
#include <map>
#include <random>
#include <algorithm>
#include <cstdlib>

static const std::string DB_CONN =
    "host=localhost port=5433 dbname=spotwhere user=spotwhere password=spotwhere_pass";

static std::string gigachatKey()
{
    const char *k = std::getenv("GIGACHAT_KEY");
    return k ? k : "";
}

static const std::string SYSTEM_PROMPT =
    "Ты — модуль разбора запроса сервиса, который советует, куда сходить.\n"
    "Пользователь описывает ситуацию своими словами. Извлеки признаки и верни\n"
    "СТРОГО JSON без пояснений, по схеме:\n"
    "{\n"
    "  \"mood\": \"тихо\" | \"шумно\" | \"романтика\" | \"\",\n"
    "  \"company\": \"вдвоём\" | \"компания\" | \"\",\n"
    "  \"budget_max\": число в рублях, или 1000000 если не указан\n"
    "}\n"
    "Отвечай ТОЛЬКО валидным JSON.";

static Json::Value loadVenues()
{
    std::ifstream file("venues.json");
    Json::Value venues;
    file >> venues;
    return venues;
}

static drogon::HttpResponsePtr jsonResponse(const Json::Value &data)
{
    Json::StreamWriterBuilder builder;
    builder["emitUTF8"] = true;
    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setContentTypeCode(drogon::CT_APPLICATION_JSON);
    resp->setBody(Json::writeString(builder, data));
    return resp;
}

static std::string makeUuid()
{
    static std::mt19937 rng(std::random_device{}());
    std::uniform_int_distribution<int> d(0, 15);
    const char *hex = "0123456789abcdef";
    std::string u = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
    for (char &c : u)
    {
        if (c == 'x') c = hex[d(rng)];
        else if (c == 'y') c = hex[(d(rng) & 0x3) | 0x8];
    }
    return u;
}

static size_t writeCb(char *ptr, size_t size, size_t nmemb, void *userdata)
{
    static_cast<std::string *>(userdata)->append(ptr, size * nmemb);
    return size * nmemb;
}

static std::string httpPost(const std::string &url, const std::string &body,
                            const std::vector<std::string> &headers)
{
    CURL *curl = curl_easy_init();
    std::string resp;
    struct curl_slist *hdrs = nullptr;
    for (const auto &h : headers)
        hdrs = curl_slist_append(hdrs, h.c_str());

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hdrs);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &resp);
    // GigaChat uses Russian CA certs that aren't in the default trust store.
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0L);
    curl_easy_perform(curl);

    curl_slist_free_all(hdrs);
    curl_easy_cleanup(curl);
    return resp;
}

static Json::Value parseJson(const std::string &s)
{
    Json::Value v;
    Json::CharReaderBuilder b;
    std::string err;
    std::unique_ptr<Json::CharReader> reader(b.newCharReader());
    reader->parse(s.c_str(), s.c_str() + s.size(), &v, &err);
    return v;
}

static std::string gigaToken()
{
    std::vector<std::string> headers = {
        "Content-Type: application/x-www-form-urlencoded",
        "Accept: application/json",
        "RqUID: " + makeUuid(),
        "Authorization: Basic " + gigachatKey(),
    };
    std::string resp = httpPost(
        "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
        "scope=GIGACHAT_API_PERS", headers);
    return parseJson(resp)["access_token"].asString();
}

// Ask GigaChat to turn free text into {mood, company, budget_max}.
static Json::Value parseText(const std::string &text)
{
    Json::Value features;
    features["mood"] = "";
    features["company"] = "";
    features["budget_max"] = 1000000;

    std::string token = gigaToken();
    if (token.empty())
        return features;

    Json::Value payload;
    payload["model"] = "GigaChat";
    Json::Value sys, usr;
    sys["role"] = "system"; sys["content"] = SYSTEM_PROMPT;
    usr["role"] = "user"; usr["content"] = text;
    payload["messages"].append(sys);
    payload["messages"].append(usr);
    payload["temperature"] = 0.1;

    Json::StreamWriterBuilder wb;
    std::string resp = httpPost(
        "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
        Json::writeString(wb, payload),
        {"Content-Type: application/json", "Accept: application/json",
         "Authorization: Bearer " + token});

    std::string content =
        parseJson(resp)["choices"][0]["message"]["content"].asString();

    auto s = content.find('{'), e = content.rfind('}');
    if (s == std::string::npos || e == std::string::npos)
        return features;

    Json::Value data = parseJson(content.substr(s, e - s + 1));
    features["mood"] = data.get("mood", "").asString();
    features["company"] = data.get("company", "").asString();
    if (data.isMember("budget_max") && data["budget_max"].isInt())
        features["budget_max"] = data["budget_max"].asInt();
    return features;
}

static std::map<std::string, double> getWeights(long userId)
{
    std::map<std::string, double> weights;
    PGconn *conn = PQconnectdb(DB_CONN.c_str());
    if (PQstatus(conn) == CONNECTION_OK)
    {
        std::string uid = std::to_string(userId);
        const char *params[1] = {uid.c_str()};
        PGresult *res = PQexecParams(
            conn, "SELECT tag, weight FROM user_tag_weights WHERE user_id = $1",
            1, nullptr, params, nullptr, nullptr, 0);
        if (PQresultStatus(res) == PGRES_TUPLES_OK)
            for (int i = 0; i < PQntuples(res); ++i)
                weights[PQgetvalue(res, i, 0)] = std::atof(PQgetvalue(res, i, 1));
        PQclear(res);
    }
    PQfinish(conn);
    return weights;
}

// Add delta to a tag's weight (update if present, otherwise insert).
static void saveWeight(long userId, const std::string &tag, double delta)
{
    PGconn *conn = PQconnectdb(DB_CONN.c_str());
    if (PQstatus(conn) == CONNECTION_OK)
    {
        std::string uid = std::to_string(userId);
        const char *sel[2] = {uid.c_str(), tag.c_str()};
        PGresult *res = PQexecParams(
            conn, "SELECT weight FROM user_tag_weights WHERE user_id = $1 AND tag = $2",
            2, nullptr, sel, nullptr, nullptr, 0);
        bool exists = PQresultStatus(res) == PGRES_TUPLES_OK && PQntuples(res) > 0;
        double current = exists ? std::atof(PQgetvalue(res, 0, 0)) : 0.0;
        PQclear(res);

        if (exists)
        {
            std::string w = std::to_string(current + delta);
            const char *p[3] = {w.c_str(), uid.c_str(), tag.c_str()};
            PQclear(PQexecParams(conn,
                "UPDATE user_tag_weights SET weight = $1 WHERE user_id = $2 AND tag = $3",
                3, nullptr, p, nullptr, nullptr, 0));
        }
        else
        {
            std::string w = std::to_string(delta);
            const char *p[3] = {uid.c_str(), tag.c_str(), w.c_str()};
            PQclear(PQexecParams(conn,
                "INSERT INTO user_tag_weights (user_id, tag, weight) VALUES ($1, $2, $3)",
                3, nullptr, p, nullptr, nullptr, 0));
        }
    }
    PQfinish(conn);
}

static bool hasTag(const Json::Value &venue, const std::string &value)
{
    if (value.empty())
        return false;
    for (const auto &tag : venue["tags"])
        if (tag.asString() == value)
            return true;
    return false;
}

static Json::Value rankVenues(const Json::Value &venues, const std::string &mood,
                              const std::string &company, int budgetMax,
                              const std::map<std::string, double> &weights)
{
    std::vector<std::pair<double, Json::Value>> scored;
    for (const auto &venue : venues)
    {
        if (venue["avg_bill"].asInt() > budgetMax)
            continue;
        double score = 0;
        if (hasTag(venue, mood)) score += 1;
        if (hasTag(venue, company)) score += 1;
        for (const auto &tag : venue["tags"])
        {
            auto it = weights.find(tag.asString());
            if (it != weights.end())
                score += it->second;
        }
        if (score > 0)
            scored.push_back({score, venue});
    }
    std::sort(scored.begin(), scored.end(),
              [](const auto &a, const auto &b) { return a.first > b.first; });

    Json::Value results(Json::arrayValue);
    for (size_t i = 0; i < scored.size() && i < 5; ++i)
        results.append(scored[i].second);
    return results;
}

int main()
{
    curl_global_init(CURL_GLOBAL_DEFAULT);
    const Json::Value venues = loadVenues();

    drogon::app().registerPreRoutingAdvice(
        [](const drogon::HttpRequestPtr &req, drogon::AdviceCallback &&stop,
           drogon::AdviceChainCallback &&next)
        {
            if (req->method() == drogon::Options)
            {
                auto resp = drogon::HttpResponse::newHttpResponse();
                resp->addHeader("Access-Control-Allow-Origin", "*");
                resp->addHeader("Access-Control-Allow-Methods", "*");
                resp->addHeader("Access-Control-Allow-Headers", "*");
                stop(resp);
            }
            else
                next();
        });
    drogon::app().registerPostHandlingAdvice(
        [](const drogon::HttpRequestPtr &, const drogon::HttpResponsePtr &resp)
        {
            resp->addHeader("Access-Control-Allow-Origin", "*");
        });

    drogon::app().registerHandler(
        "/health",
        [](const drogon::HttpRequestPtr &,
           std::function<void(const drogon::HttpResponsePtr &)> &&callback)
        {
            Json::Value json;
            json["status"] = "ok";
            json["service"] = "spotwhere";
            callback(jsonResponse(json));
        },
        {drogon::Get});

    drogon::app().registerHandler(
        "/venues",
        [venues](const drogon::HttpRequestPtr &,
                 std::function<void(const drogon::HttpResponsePtr &)> &&callback)
        {
            callback(jsonResponse(venues));
        },
        {drogon::Get});

    drogon::app().registerHandler(
        "/recommend",
        [venues](const drogon::HttpRequestPtr &req,
                 std::function<void(const drogon::HttpResponsePtr &)> &&callback)
        {
            auto body = req->getJsonObject();
            std::string text = body ? (*body)["text"].asString() : "";
            long userId = (body && body->isMember("user_id"))
                              ? (*body)["user_id"].asLargestInt() : 0;

            Json::Value features = parseText(text);
            auto weights = getWeights(userId);

            Json::Value out;
            out["results"] = rankVenues(
                venues, features["mood"].asString(), features["company"].asString(),
                features["budget_max"].asInt(), weights);
            callback(jsonResponse(out));
        },
        {drogon::Post});

    drogon::app().registerHandler(
        "/like",
        [venues](const drogon::HttpRequestPtr &req,
                 std::function<void(const drogon::HttpResponsePtr &)> &&callback)
        {
            auto body = req->getJsonObject();
            long userId = (body && body->isMember("user_id"))
                              ? (*body)["user_id"].asLargestInt() : 0;
            int venueId = (body && body->isMember("venue_id"))
                              ? (*body)["venue_id"].asInt() : 0;

            for (const auto &venue : venues)
                if (venue["id"].asInt() == venueId)
                {
                    for (const auto &tag : venue["tags"])
                        saveWeight(userId, tag.asString(), 0.2);
                    break;
                }

            Json::Value out;
            out["status"] = "ok";
            callback(jsonResponse(out));
        },
        {drogon::Post});

    drogon::app().setDocumentRoot("../frontend");

    LOG_INFO << "Spotwhere backend on http://127.0.0.1:8080";
    drogon::app().addListener("127.0.0.1", 8080).run();
    return 0;
}
